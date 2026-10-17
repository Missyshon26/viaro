"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ApiError } from "@/lib/api/client";
import {
  getFareEstimate,
  createBooking,
  cancelBookingBeforeDispatch,
  listVehicleClasses,
} from "@/lib/api/bookings";
import { cancelAssignedTrip } from "@/lib/api/trips";
import type { CruisePort, FareBreakdown, TripType } from "@/lib/api/types";
import type { FormState } from "@/lib/actions/auth";
import { CRUISE_PORTS, MAX_CAR_SEATS, cityCoords, VEHICLE_CLASSES } from "@/lib/constants";

function toFormState(err: unknown): FormState {
  if (err instanceof ApiError) return { error: err.message, fieldErrors: err.fieldErrors };
  return { error: "Something went wrong. Please try again." };
}

export interface QuoteState extends FormState {
  fare?: FareBreakdown;
  /** Echoed back so the confirm step submits exactly what was quoted. */
  input?: {
    city: string;
    tripType: TripType;
    vehicleClass: string;
    pickup: string;
    drop: string;
    scheduledAt: string;
    hours?: number;
    flightNumber?: string;
    /** UML "Request / Assign Favorite Driver" — dispatch honours it only if free. */
    favoriteDriverId?: string;
    meetAndGreet: boolean;
    carSeats: number;
    cruisePort?: CruisePort;
    cruiseShip?: string;
  };
}

/** The extras on a submitted form, normalised the same way for quote and confirm. */
function readExtras(formData: FormData) {
  const meetAndGreet = ["on", "true", "1"].includes(String(formData.get("meetAndGreet") ?? ""));
  const seats = Number.parseInt(String(formData.get("carSeats") ?? "0"), 10);
  const carSeats = Number.isFinite(seats) ? Math.min(Math.max(seats, 0), MAX_CAR_SEATS) : 0;
  const port = String(formData.get("cruisePort") ?? "");
  const cruisePort = CRUISE_PORTS.some((p) => p.value === port) ? (port as CruisePort) : undefined;
  const cruiseShip = String(formData.get("cruiseShip") ?? "").trim().slice(0, 80) || undefined;
  return { meetAndGreet, carSeats, cruisePort, cruiseShip: cruisePort ? cruiseShip : undefined };
}

/**
 * An hourly charter often has no fixed end ("as directed"), but the API stores a drop-off
 * for every booking — so a blank one is the pickup, which is where most charters end.
 */
const dropFor = (tripType: TripType, pickup: string, drop: string) =>
  tripType === "hourly" && drop.length < 3 ? pickup : drop;

/**
 * Prices every vehicle class for one journey, so the vehicle step can show a real
 * number on each card.
 *
 * The uplift per class lives in the backend's config/vehicles.ts and is deliberately
 * not duplicated here: the only way to show a price guaranteed to match what the
 * booking will charge is to ask the API for it. One action, N server-side calls, one
 * round trip from the browser.
 *
 * A class that fails to price is omitted rather than guessed — its card then reads
 * "On review" instead of showing a number nobody stands behind.
 */
export async function quoteVehiclesAction(input: {
  city: string;
  tripType: TripType;
  scheduledAt: string;
  hours?: number;
  /** For route prices (Tacoma ↔ Sea-Tac) and the Meet and Greet fee. */
  pickup?: string;
  drop?: string;
  meetAndGreet?: boolean;
}): Promise<Record<string, number>> {
  // Price whatever the catalogue currently holds, not a list compiled into this build —
  // a class added in the admin console must be quotable without a redeploy.
  let classes: { value: string }[] = VEHICLE_CLASSES;
  try {
    classes = await listVehicleClasses();
  } catch {
    /* Fall back to the built-in list; the cards still price. */
  }

  const results = await Promise.allSettled(
    classes.map(async (vehicle) => {
      const fare = await getFareEstimate({
        city: input.city,
        tripType: input.tripType,
        requestedAt: input.scheduledAt,
        ...(input.tripType === "hourly" && input.hours ? { hours: input.hours } : {}),
        vehicleClass: vehicle.value,
        ...(input.pickup ? { pickup: input.pickup } : {}),
        ...(input.drop ? { drop: input.drop } : {}),
        meetAndGreet: input.meetAndGreet ? "true" : "false",
      });
      return [vehicle.value, fare.fare] as const;
    }),
  );

  const prices: Record<string, number> = {};
  for (const result of results) {
    if (result.status === "fulfilled") prices[result.value[0]] = result.value[1];
  }
  return prices;
}

/** Step 1: price it. `roleGuard('customer')` means this needs a signed-in customer. */
export async function quoteAction(
  _prev: QuoteState | undefined,
  formData: FormData,
): Promise<QuoteState> {
  const city = String(formData.get("city") ?? "Seattle");
  const tripType = String(formData.get("tripType") ?? "point2point") as TripType;
  const vehicleClass = String(formData.get("vehicleClass") ?? "sedan");
  const pickup = String(formData.get("pickup") ?? "").trim();
  const drop = dropFor(tripType, pickup, String(formData.get("drop") ?? "").trim());
  const extras = readExtras(formData);
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const hours = Number(formData.get("hours") ?? 4);
  const flightNumber = String(formData.get("flightNumber") ?? "").trim();
  const favoriteDriverId = String(formData.get("favoriteDriverId") ?? "").trim();

  const fieldErrors: Record<string, string> = {};
  // The API enforces a 3-character minimum on both addresses.
  if (pickup.length < 3) fieldErrors.pickup = "Enter a pickup address (3 characters or more)";
  if (drop.length < 3) fieldErrors.drop = "Enter a drop-off address (3 characters or more)";
  if (!date) fieldErrors.date = "Pick a date";
  if (!time) fieldErrors.time = "Pick a time";
  if (tripType === "airport" && flightNumber.length < 2) {
    fieldErrors.flightNumber = "Airport bookings need the flight number";
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  // Offset-less ISO: the API reads it as America/Los_Angeles wall time.
  const scheduledAt = `${date}T${time}:00`;

  try {
    const fare = await getFareEstimate({
      city,
      tripType,
      requestedAt: scheduledAt,
      ...(tripType === "hourly" ? { hours } : {}),
      // Without this the review would quote the base rate and the booking would be
      // created at the class rate — the two must be priced identically.
      vehicleClass,
      pickup,
      drop,
      meetAndGreet: extras.meetAndGreet ? "true" : "false",
    });
    return {
      fare,
      input: {
        city, tripType, vehicleClass, pickup, drop, scheduledAt,
        ...extras,
        ...(tripType === "hourly" ? { hours } : {}),
        ...(tripType === "airport" ? { flightNumber } : {}),
        ...(favoriteDriverId ? { favoriteDriverId } : {}),
      },
    };
  } catch (err) {
    return toFormState(err);
  }
}

/**
 * Step 2: commit it.
 *
 * A round trip is two independent bookings — the API has no notion of a paired
 * journey — so the return leg is created as its own booking with the ends swapped.
 * They are created in order, and a failure on the return is reported without
 * discarding the outbound, which by then genuinely exists.
 */
export async function confirmBookingAction(
  _prev: FormState | undefined,
  formData: FormData,
): Promise<FormState> {
  const city = String(formData.get("city") ?? "");
  const tripType = String(formData.get("tripType") ?? "point2point") as TripType;
  const pickup = String(formData.get("pickup") ?? "");
  const drop = dropFor(tripType, pickup, String(formData.get("drop") ?? ""));
  const { cruisePort, cruiseShip, ...legExtras } = readExtras(formData);
  const hours = Number(formData.get("hours") ?? 0);
  const flightNumber = String(formData.get("flightNumber") ?? "").trim();
  const favoriteDriverId = String(formData.get("favoriteDriverId") ?? "").trim();
  const vehicleClass = String(formData.get("vehicleClass") ?? "sedan");
  const passengers = Number(formData.get("passengers") ?? 0);
  const returnScheduledAt = String(formData.get("returnScheduledAt") ?? "").trim();
  const returnFlightNumber = String(formData.get("returnFlightNumber") ?? "").trim();
  const coords = cityCoords(city);
  const walletCreditRequested = Number(formData.get("walletCreditRequested") ?? 0);

  const common = {
    vehicleClass,
    tripType,
    city,
    ...(passengers > 0 ? { passengers } : {}),
    ...(tripType === "hourly" && hours ? { hours } : {}),
    ...(favoriteDriverId ? { favoriteDriverId } : {}),
    // Both legs: the seats travel with the child, and Meet and Greet is per journey.
    ...legExtras,
  };

  let bookingId: string;
  try {
    const created = await createBooking({
      ...common,
      pickup: { lat: coords.lat, lng: coords.lng, address: pickup },
      // Without a geocoder both ends resolve to the city centre; the addresses the
      // passenger typed are preserved verbatim.
      drop: { lat: coords.lat, lng: coords.lng, address: drop },
      scheduledAt: String(formData.get("scheduledAt") ?? ""),
      // Only on the outbound leg: a round trip is two bookings, and sending the same
      // request twice would try to spend the same credit on both.
      ...(walletCreditRequested > 0 ? { walletCreditRequested } : {}),
      ...(tripType === "airport" ? { flightDetails: { flightNumber } } : {}),
      // Outbound only — the return leg ends at the terminal rather than starting there.
      ...(cruisePort ? { cruisePort, ...(cruiseShip ? { cruiseShip } : {}) } : {}),
    });
    bookingId = created.booking._id;
  } catch (err) {
    return toFormState(err);
  }

  if (returnScheduledAt) {
    try {
      await createBooking({
        ...common,
        pickup: { lat: coords.lat, lng: coords.lng, address: drop },
        drop: { lat: coords.lat, lng: coords.lng, address: pickup },
        scheduledAt: returnScheduledAt,
        ...(tripType === "airport"
          ? { flightDetails: { flightNumber: returnFlightNumber || flightNumber } }
          : {}),
      });
    } catch (err) {
      const state = toFormState(err);
      return {
        ...state,
        error: `Your outbound journey is booked, but the return leg failed: ${
          state.error ?? "unknown error"
        } You can add it from your trips.`,
      };
    }
  }

  revalidatePath("/trips");
  redirect(`/trips/${bookingId}?created=1`);
}

/* ------------------------------ cancellation ------------------------------- */

export async function cancelBookingAction(
  bookingId: string,
  status: string,
  tripType: TripType,
  tripId?: string,
  /**
   * Optional note from the passenger. Both API paths already accepted one; neither was
   * ever given it, so operations saw cancellations with no explanation attached.
   */
  reason?: string,
): Promise<FormState | void> {
  const note = reason?.trim() || undefined;
  try {
    // The API rejects DELETE /bookings/:id once a driver is assigned and says so.
    if (status === "assigned" && tripId) {
      await cancelAssignedTrip(tripId, tripType, note);
    } else {
      await cancelBookingBeforeDispatch(bookingId, note);
    }
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath("/trips");
  redirect("/trips?cancelled=1");
}

