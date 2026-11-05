/**
 * The number printed on a booking's invoice and receipt. Mirrors the backend's rule
 * (booking.documents.ts) so what the console shows is what the customer's document says:
 * the running trip number, else the old site's trip number, else INV- plus the short reference.
 */
export function invoiceNumber(booking: { _id: string; tripNo?: string | null; legacy?: { tripNo?: string | null } | null }): string {
  return booking.tripNo || booking.legacy?.tripNo || `INV-${booking._id.slice(-6).toUpperCase()}`;
}
