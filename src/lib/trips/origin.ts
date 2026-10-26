import type { Booking } from "@/lib/api/types";

/** Who made the booking: an operator in this console, the passenger on the website, or the old system. */
export function bookedBy(booking: Pick<Booking, "source" | "legacy">): { label: string; imported: boolean } {
  if (booking.legacy) {
    const admin = String(booking.legacy.bookingSource ?? "").toLowerCase() === "admin";
    return { label: admin ? "Admin (old system)" : "Web (old system)", imported: true };
  }
  return { label: booking.source === "admin" ? "Admin" : "Web", imported: false };
}

export type PaymentTone = "success" | "warn" | "danger" | "neutral";

/**
 * How a booking's payment reads on the screen: green when paid, red when it failed or is owed
 * past the pickup, amber for partly or fully refunded and for "not paid yet", grey when there is
 * nothing to pay (a cancelled booking).
 */
export function paymentSummary(
  booking: Pick<Booking, "payment" | "legacy" | "status" | "scheduledAt">,
  now = Date.now(),
): { label: string; hint: string; tone: PaymentTone } {
  const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const card = booking.payment;
  if (card) {
    if (card.status === "partially_refunded") return { label: "Part refunded", hint: `${money(card.amount)} card payment`, tone: "warn" };
    if (card.status === "refunded") return { label: "Refunded", hint: `${money(card.amount)} card payment`, tone: "warn" };
    if ((card.status as string) === "failed") return { label: "Failed", hint: "The card payment did not go through", tone: "danger" };
    return { label: "Paid", hint: `${money(card.amount)} card payment`, tone: "success" };
  }

  const old = String(booking.legacy?.paymentStatus ?? "").toLowerCase();
  if (old === "paid") return { label: "Paid", hint: "Taken in the old system", tone: "success" };
  if (old === "refunded") return { label: "Refunded", hint: "Refunded in the old system", tone: "warn" };
  if (old === "failed") return { label: "Failed", hint: "The payment failed in the old system", tone: "danger" };

  if (booking.status === "cancelled") return { label: "No payment", hint: "The booking was cancelled", tone: "neutral" };
  const pickupPassed = new Date(booking.scheduledAt).getTime() < now;
  return pickupPassed
    ? { label: "Unpaid", hint: "The pickup has passed with no payment recorded", tone: "danger" }
    : { label: "Not paid yet", hint: "No card payment recorded", tone: "warn" };
}
