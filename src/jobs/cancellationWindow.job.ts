import type { Job } from 'bullmq';
import { Booking } from '../models/Booking';
import { getQueue, registerWorker, QUEUE_NAMES } from './queues';
import { REFUND_THRESHOLD_HOURS } from '../modules/cancellation/cancellation.service';
import { format, hoursUntil, now, toAppTime } from '../config/timezone';
import { logger } from '../utils/logger';
import * as notify from '../modules/notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../modules/notifications/notifications.service';

/**
 * Cancellation-window checks (spec §1, §3).
 *
 * The refund thresholds (spec §8 rule 6) are silent deadlines: a customer who cancels one
 * minute after the boundary loses 90% of their money with no warning. This job fires at
 * the exact moment the free-cancellation window closes for a booking, so the customer is
 * told rather than surprised.
 *
 * Scheduled when a booking is created; the boundary is computed in America/Los_Angeles
 * like every other time comparison in the system.
 */
export const CANCELLATION_WINDOW_JOB = 'cancellation-window-closing';

interface CancellationWindowJobData {
  bookingId: string;
}

export async function scheduleCancellationWindowCheck(
  bookingId: string,
  scheduledAt: Date,
  tripType: keyof typeof REFUND_THRESHOLD_HOURS,
): Promise<void> {
  const thresholdHours = REFUND_THRESHOLD_HOURS[tripType];
  const boundary = toAppTime(scheduledAt).minus({ hours: thresholdHours });
  // `now()` is the app-timezone helper; toAppTime(new Date()) was the long way round to
  // the same thing and the one place this file bypassed the rule.
  const delayMs = boundary.diff(now(), 'milliseconds').milliseconds;

  // Booked inside the window already — there is no free-cancellation period to warn about.
  if (delayMs <= 0) return;

  await getQueue(QUEUE_NAMES.CANCELLATION).add(
    CANCELLATION_WINDOW_JOB,
    { bookingId } satisfies CancellationWindowJobData,
    // ':' is reserved by BullMQ and rejected in a custom job id — see penalty.job.ts.
    { delay: Math.floor(delayMs), jobId: `cancel-window-${bookingId}` },
  );

  logger.info(
    `Cancellation window for booking ${bookingId} closes ${format(boundary)} (in ${Math.round(delayMs / 60000)} min)`,
  );
}

async function processWindowClosing(data: CancellationWindowJobData): Promise<void> {
  const booking = await Booking.findById(data.bookingId).lean();
  if (!booking) return;
  if (booking.status === 'cancelled') return; // already gone, nothing to warn about

  const thresholdHours = REFUND_THRESHOLD_HOURS[booking.tripType];

  await notify.send(booking.customerId, NOTIFICATION_TYPES.CANCELLATION_WINDOW_CLOSING, {
    message: `Free cancellation for your ${format(booking.scheduledAt)} ride has now closed — cancelling from here carries no refund.`,
    bookingId: String(booking._id),
    tripType: booking.tripType,
    thresholdHours,
    scheduledAt: format(booking.scheduledAt),
    hoursUntilPickup: Math.round(hoursUntil(booking.scheduledAt) * 10) / 10,
  });
}

/** Called once from server.ts during boot. */
export function registerCancellationWindowWorker(): void {
  registerWorker(QUEUE_NAMES.CANCELLATION, async (job: Job) => {
    if (job.name === CANCELLATION_WINDOW_JOB) {
      return processWindowClosing(job.data as CancellationWindowJobData);
    }
    logger.warn(`Unknown cancellation job '${job.name}'`);
  });
}
