import { Types } from 'mongoose';
import { User } from '../../models/User';
import { now, toDate } from '../../config/timezone';
import type { BookingDocument, IBookingCancellation } from '../../models/Booking';
import type { TripDocument } from '../../models/Trip';

/**
 * Recording who cancelled a booking and why.
 *
 * One module for the same reason `booking.amendments.ts` is one module: there are four
 * ways a booking can end — the customer before dispatch, the customer after a chauffeur
 * accepted, the chauffeur, and an operator from the console — and each used to write its
 * own partial version of the story. Two of them wrote nothing at all, so a cancelled
 * booking in the admin console was just a status with no author.
 *
 * The trail is deliberately written to the Booking even when a Trip exists. Operations
 * lists bookings, a pending booking has no Trip to write to, and a single read path is
 * worth the duplicated field.
 */

/** What the console shows when an account has since been renamed or scrubbed. */
const UNKNOWN_ACTOR = 'Unknown user';

/**
 * Looks up the actor's display name once, at cancellation time.
 *
 * Snapshotting rather than joining on read is the point: account deletion is soft and
 * scrubs PII, so a join would quietly blank the author of an old cancellation. The id is
 * stored alongside for anyone who needs to reach the live record.
 */
export async function resolveActorName(userId?: string): Promise<string | undefined> {
  if (!userId) return undefined;
  const user = await User.findById(userId).select('name').lean();
  return user?.name ?? UNKNOWN_ACTOR;
}

export interface CancellationActor {
  by: IBookingCancellation['by'];
  /** Omitted only where no human is attributable — currently nothing does this. */
  byUserId?: string;
  reason?: string;
  /** Operations turned the request down rather than a ride being called off. */
  rejected?: boolean;
}

/**
 * Writes the record onto the booking. Does NOT save — the callers are already inside a
 * save of their own and a second write would be wasted.
 *
 * A blank or whitespace-only reason is stored as absent rather than as an empty string,
 * so the console can tell "no reason given" from "reason given" with a plain check.
 */
export async function recordBookingCancellation(
  booking: BookingDocument,
  actor: CancellationActor,
): Promise<IBookingCancellation> {
  const reason = actor.reason?.trim();

  const record: IBookingCancellation = {
    by: actor.by,
    ...(actor.rejected ? { rejected: true } : {}),
    ...(reason ? { reason } : {}),
    ...(actor.byUserId
      ? {
          byUserId: new Types.ObjectId(actor.byUserId),
          byName: await resolveActorName(actor.byUserId),
        }
      : {}),
    at: toDate(now()),
  };

  booking.cancellation = record;
  return record;
}

/**
 * Mirrors the same actor onto the trip's own cancellation block, next to the refund
 * figures that only make sense there.
 */
export function applyTripCancellationActor(
  trip: TripDocument,
  record: IBookingCancellation,
): void {
  trip.cancellation = {
    ...trip.cancellation,
    reason: record.reason ?? trip.cancellation?.reason,
    cancelledBy: record.by,
    cancelledByUserId: record.byUserId,
    cancelledByName: record.byName,
  };
}
