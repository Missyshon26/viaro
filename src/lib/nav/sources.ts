import { getBookingsDashboard, getUsersDashboard, listTickets } from "@/lib/api/admin";
import { listMyTrips } from "@/lib/api/driver";

/**
 * What the operations console counts as "new", per nav entry.
 *
 * Only sections with a defensible notion of newness are here. Revenue, Reports, City
 * pricing and Vehicles are things an operator changes rather than things that arrive, so
 * badging them would just be decoration.
 *
 * Each source returns the ids currently in that section; the hook decides which of them
 * this browser has already been shown.
 */

/** Tickets nobody has closed out. 'pending' is waiting on us too, not just 'open'. */
const OPEN_TICKET_STATUSES = new Set(["open", "pending"]);

export async function collectBadgeIds(): Promise<Record<string, string[]>> {
  const [bookings, trips, tickets, users] = await Promise.allSettled([
    getBookingsDashboard(1, 100),
    listMyTrips({ limit: 100 }),
    listTickets(),
    getUsersDashboard(1, 100),
  ]);

  const result: Record<string, string[]> = {};

  /*
   * Trips: the badge is the OPS QUEUE, not the volume of journeys.
   *
   * A booking with no trip against it is one nobody is driving — either still awaiting
   * dispatch or sitting in the pool unclaimed. Counting every booking would make the
   * badge a number that never goes down and means nothing; counting the unassigned ones
   * makes it a to-do list.
   */
  if (bookings.status === "fulfilled" && trips.status === "fulfilled") {
    const claimed = new Set(
      (trips.value.items ?? []).map((trip) => String(trip.bookingId)),
    );
    result["/trips"] = (bookings.value.items ?? [])
      .filter(
        (booking) => booking.status !== "cancelled" && !claimed.has(booking._id),
      )
      .map((booking) => booking._id);
  }

  if (tickets.status === "fulfilled") {
    const rows = Array.isArray(tickets.value)
      ? tickets.value
      : (tickets.value.items ?? []);
    result["/support"] = rows
      .filter((ticket) => OPEN_TICKET_STATUSES.has(ticket.status))
      .map((ticket) => ticket._id);
  }

  if (users.status === "fulfilled") {
    result["/users"] = (users.value.items ?? []).map((user) => user._id);
  }

  return result;
}
