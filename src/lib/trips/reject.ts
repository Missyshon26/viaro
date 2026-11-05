/** A request can be turned down only while no chauffeur has taken it: still pending or just dispatched. */
export function canReject(booking: { status: string }): boolean {
  return booking.status === "pending" || booking.status === "dispatched";
}
