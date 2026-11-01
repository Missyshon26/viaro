import { Booking } from '../../models/Booking';
import { Trip } from '../../models/Trip';
import { User } from '../../models/User';
import { getGoHighLevel } from '../../integrations/goHighLevel';
import { now, toDate } from '../../config/timezone';
import { logger } from '../../utils/logger';

/** Addresses nobody can read: the placeholder accounts made by tests, the import and guest checkout fallbacks. */
const UNREACHABLE = /@(?:[a-z0-9-]+\.)*(?:test|invalid|example|localhost)$/i;

const split = (name?: string) => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return { first: parts[0], last: parts.slice(1).join(' ') || undefined };
};

/**
 * Hands the customer to GoHighLevel so its workflow can send the feedback survey, once a trip is
 * really complete.
 *
 *   - Once per trip: the trip is claimed first, with one conditional update, so a retried request
 *     or two operators clicking at once cannot send two surveys. If GoHighLevel then refuses, the
 *     claim is let go again so a later completion can try.
 *   - Not for a no-show: the passenger never rode.
 *   - Not for an address nobody can read (a placeholder account).
 *
 * Never throws, and nobody waits for it: a CRM that is slow or down must not touch the
 * completion the chauffeur or operator just made.
 */
export async function requestFeedback(tripId: string): Promise<'sent' | 'skipped' | 'failed'> {
  try {
    const ghl = getGoHighLevel();
    if (!ghl) return 'skipped';

    const trip = await Trip.findById(tripId).select('bookingId noShow status feedbackRequestedAt').lean();
    if (!trip || trip.status !== 'completed' || trip.noShow || trip.feedbackRequestedAt) return 'skipped';

    const booking = await Booking.findById(trip.bookingId).select('customerId passengerName').lean();
    const customer = booking ? await User.findById(booking.customerId).select('name firstName lastName email phone').lean() : null;
    const email = customer?.email?.trim();
    if (!customer || !email || UNREACHABLE.test(email)) return 'skipped';

    const claimed = await Trip.findOneAndUpdate(
      { _id: tripId, feedbackRequestedAt: { $exists: false } },
      { $set: { feedbackRequestedAt: toDate(now()) } },
    );
    if (!claimed) return 'skipped';

    const fallback = split(customer.name);
    const result = await ghl.tagServiceCompleted({
      email,
      phone: customer.phone || undefined,
      firstName: customer.firstName || fallback.first,
      lastName: customer.lastName || fallback.last,
    });

    if (!result.ok) {
      await Trip.updateOne({ _id: tripId }, { $unset: { feedbackRequestedAt: 1 } });
      logger.warn(`GoHighLevel did not take trip ${tripId}'s feedback request: ${result.reason}`);
      return 'failed';
    }
    logger.info(`GoHighLevel: ${email} tagged for the feedback survey (trip ${tripId})`);
    return 'sent';
  } catch (err) {
    logger.warn(`Feedback request for trip ${tripId} failed`, err);
    return 'failed';
  }
}
