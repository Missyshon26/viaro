"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiError } from "@/lib/api/client";
import { rateTrip, changeTripLocation, changeVehicleClass, sendChatMessage } from "@/lib/api/trips";
import { updateBooking } from "@/lib/api/bookings";
import { requestFavoriteDriver } from "@/lib/api/bookings";
import { addFavorite, removeFavorite } from "@/lib/api/account";
import { releaseCredit, useCredit } from "@/lib/api/wallet";
import { cityCoords } from "@/lib/constants";
import type { FormState } from "@/lib/actions/auth";

function toFormState(err: unknown): FormState {
  if (err instanceof ApiError) return { error: err.message, fieldErrors: err.fieldErrors };
  return { error: "Something went wrong. Please try again." };
}

/* --------------------------------- rating ---------------------------------- */

/** Score is 1-5; the API field is `score`, not `rating`. */
export async function rateTripAction(
  _prev: (FormState & { saved?: boolean }) | undefined,
  formData: FormData,
): Promise<FormState & { saved?: boolean }> {
  const tripId = String(formData.get("tripId") ?? "");
  const score = Number(formData.get("score") ?? 0);

  if (!score || score < 1 || score > 5) {
    return { fieldErrors: { score: "Choose between one and five stars" } };
  }

  try {
    await rateTrip(tripId, score, String(formData.get("comment") ?? "").trim() || undefined);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/trips/${tripId}`);
  return { saved: true };
}

/* ----------------------------- change a booking ---------------------------- */

/**
 * Before dispatch the booking itself is edited; once a trip exists the trip endpoints
 * own the route and the class. The screen picks based on status.
 */
export async function updateBookingAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const city = String(formData.get("city") ?? "Seattle");
  const pickup = String(formData.get("pickup") ?? "").trim();
  const drop = String(formData.get("drop") ?? "").trim();
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const vehicleClass = String(formData.get("vehicleClass") ?? "");

  const fieldErrors: Record<string, string> = {};
  if (pickup && pickup.length < 3) fieldErrors.pickup = "At least 3 characters";
  if (drop && drop.length < 3) fieldErrors.drop = "At least 3 characters";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  const coords = cityCoords(city);

  try {
    await updateBooking(bookingId, {
      ...(pickup ? { pickup: { lat: coords.lat, lng: coords.lng, address: pickup } } : {}),
      ...(drop ? { drop: { lat: coords.lat, lng: coords.lng, address: drop } } : {}),
      ...(vehicleClass ? { vehicleClass } : {}),
      ...(date && time ? { scheduledAt: `${date}T${time}:00` } : {}),
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/trips/${bookingId}`);
  redirect(`/trips/${bookingId}?updated=1`);
}

/* ------------------------- change a trip in progress ----------------------- */

export async function changeVehicleClassAction(
  _prev: (FormState & { saved?: boolean }) | undefined,
  formData: FormData,
): Promise<FormState & { saved?: boolean }> {
  const tripId = String(formData.get("tripId") ?? "");
  try {
    await changeVehicleClass(tripId, String(formData.get("vehicleClass") ?? "sedan"));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/trips/${tripId}`);
  return { saved: true };
}

export async function changeTripLocationAction(
  _prev: (FormState & { saved?: boolean }) | undefined,
  formData: FormData,
): Promise<FormState & { saved?: boolean }> {
  const tripId = String(formData.get("tripId") ?? "");
  const city = String(formData.get("city") ?? "Seattle");
  const pickup = String(formData.get("pickup") ?? "").trim();
  const drop = String(formData.get("drop") ?? "").trim();

  if (!pickup && !drop) {
    return { error: "Change the pickup, the drop-off, or both." };
  }
  const coords = cityCoords(city);

  try {
    await changeTripLocation(tripId, {
      ...(pickup ? { pickup: { lat: coords.lat, lng: coords.lng, address: pickup } } : {}),
      ...(drop ? { drop: { lat: coords.lat, lng: coords.lng, address: drop } } : {}),
    });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/trips/${tripId}`);
  return { saved: true };
}

/* -------------------------------- favourites -------------------------------- */

export async function addFavoriteAction(driverId: string): Promise<FormState | void> {
  try {
    await addFavorite(driverId);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/favorites");
  revalidatePath("/trips");
}

export async function removeFavoriteAction(driverId: string): Promise<FormState | void> {
  try {
    await removeFavorite(driverId);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/account");
  revalidatePath("/favorites");
}

/** Asks for a specific chauffeur on a booking that has not been dispatched yet. */
export async function requestFavoriteDriverAction(
  bookingId: string,
  driverId: string,
): Promise<FormState | void> {
  try {
    await requestFavoriteDriver(bookingId, driverId);
  } catch (err) {
    // A 409 here means that chauffeur is busy — dispatch falls back automatically.
    return toFormState(err);
  }
  revalidatePath(`/trips/${bookingId}`);
}

/* ------------------------------ wallet credit ------------------------------- */

export async function useCreditAction(
  _prev: (FormState & { saved?: boolean }) | undefined,
  formData: FormData,
): Promise<FormState & { saved?: boolean }> {
  const tripId = String(formData.get("tripId") ?? "");
  const amount = Number(formData.get("amount") ?? 0);

  if (!(amount > 0)) return { fieldErrors: { amount: "Enter an amount above zero" } };

  try {
    /*
     * Not a React hook, despite the name: `useCredit` is the POST /wallet/use-credit
     * wrapper in lib/api/wallet.ts, named after the endpoint. The rules-of-hooks lint
     * rule matches on the `use` prefix alone and cannot tell the difference, and this
     * file is a server action with no React render to violate.
     */
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await useCredit(tripId, amount);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/trips/${tripId}`);
  revalidatePath("/wallet");
  return { saved: true };
}

/**
 * Cancels the wallet credit a passenger chose at booking, before it has been spent.
 *
 * Distinct from releaseCreditAction: nothing has left the wallet yet, so there is no
 * money to move — this only clears the request on the booking. Sending 0 is how the API
 * expresses "no credit", which is why it is not simply omitted.
 */
export async function clearRequestedCreditAction(
  _prev: (FormState & { saved?: boolean }) | undefined,
  formData: FormData,
): Promise<FormState & { saved?: boolean }> {
  const bookingId = String(formData.get("bookingId") ?? "");

  try {
    await updateBooking(bookingId, { walletCreditRequested: 0 });
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/trips/${bookingId}`);
  revalidatePath("/wallet");
  return { saved: true };
}

/**
 * Takes wallet credit back off a trip and returns it to the balance.
 *
 * No amount is sent: the control this backs is "remove", not "adjust". The API refuses
 * once the fare has been charged, and that refusal is shown rather than swallowed —
 * a passenger who cannot undo it needs to know why.
 */
export async function releaseCreditAction(
  _prev: (FormState & { saved?: boolean }) | undefined,
  formData: FormData,
): Promise<FormState & { saved?: boolean }> {
  const tripId = String(formData.get("tripId") ?? "");

  try {
    await releaseCredit(tripId);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/trips/${tripId}`);
  revalidatePath("/wallet");
  return { saved: true };
}

/** Posts a chat message to the trip; the page re-reads the thread afterwards. */
export async function sendChatMessageAction(
  tripId: string,
  bookingId: string,
  message: string,
): Promise<FormState | void> {
  const text = message.trim();
  if (!text) return { error: "Type a message first" };
  try {
    await sendChatMessage(tripId, text.slice(0, 2000));
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/trips/${bookingId}/chat`);
}
