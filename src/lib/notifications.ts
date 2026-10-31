import type { Notification } from "@/lib/api/types";

/**
 * Where a notification leads. A booking opens its trip; a support case opens the support
 * screen; a new driver opens the drivers screen. Anything else has nowhere to go and is
 * just read.
 */
export function notificationHref(n: Pick<Notification, "payload" | "type">): string | null {
  const payload = n.payload ?? {};
  if (typeof payload.bookingId === "string") return `/trips/${payload.bookingId}`;
  if (typeof payload.ticketId === "string") return "/support";
  if (n.type === "ops.driver_registered") return "/drivers";
  return null;
}

/** What the notification is about, for the small label beside it. */
export function notificationKind(type: string): string {
  if (type.startsWith("ops.booking")) return "Booking";
  if (type.startsWith("ops.trip") || type === "ops.driver_cancelled") return "Trip";
  if (type.startsWith("ops.driver")) return "Driver";
  if (type.startsWith("ops.support")) return "Support";
  if (type === "ops.payment_failed") return "Payment";
  return "Update";
}

/** A notification that needs someone to act, not only to know. */
export const needsAction = (type: string) =>
  ["ops.driver_cancelled", "ops.payment_failed", "ops.support_new", "ops.support_reply"].includes(type);

/** Pacific time, like every other time on the platform. */
export const notificationTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const notificationText = (n: Pick<Notification, "payload" | "type">) =>
  n.payload?.message ?? n.type.replace(/[._]/g, " ");
