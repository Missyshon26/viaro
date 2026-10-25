import type { Job } from 'bullmq';
import { Booking } from '../models/Booking';
import { Trip } from '../models/Trip';
import { Driver } from '../models/Driver';
import { PenaltyEvent } from '../models/PenaltyEvent';
import { getQueue, registerWorker, QUEUE_NAMES } from './queues';
import { getIo, ns } from '../sockets/io';
import { logger } from '../utils/logger';
import * as notify from '../modules/notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../modules/notifications/notifications.service';

/**
 * Spec §8 rule 5 — the penalty timer.
 *
 * When a booking is broadcast to the public pool, a job is armed 2 minutes out. If no
 * driver has accepted by then, every driver who was offered the ride and stayed silent
 * gets a PenaltyEvent, and their subsequent ride alerts are delayed by 2 minutes.
 *
 * This lives in BullMQ rather than setTimeout deliberately: an in-process timer dies on
 * every deploy or crash, which would let a driver dodge penalties by timing a restart.
 */
export const PENALTY_JOB = 'penalty-check';
export const DELAYED_ALERT_JOB = 'delayed-ride-alert';
export const RESPONSE_WINDOW_MS = 2 * 60 * 1000;

interface PenaltyJobData {
  bookingId: string;
  driverIds: string[];
}

interface DelayedAlertJobData {
  bookingId: string;
  driverId: string;
  payload: Record<string, unknown>;
}

export async function schedulePenaltyCheck(bookingId: string, driverIds: string[]): Promise<void> {
  if (driverIds.length === 0) return;

  await getQueue(QUEUE_NAMES.DISPATCH).add(
    PENALTY_JOB,
    { bookingId, driverIds } satisfies PenaltyJobData,
    {
      delay: RESPONSE_WINDOW_MS,
      // One check per booking however many times dispatch runs.
      // Hyphen, not a colon: BullMQ reserves ':' as its own Redis key separator and
      // rejects a custom job id containing one. It threw on every call, which meant this
      // job was never armed and the failure surfaced only as a log line.
      jobId: `penalty-${bookingId}`,
    },
  );
}

/** Re-emits a ride alert to a penalised driver after their 2-minute delay. */
export async function scheduleDelayedAlert(
  bookingId: string,
  driverId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await getQueue(QUEUE_NAMES.DISPATCH).add(
    DELAYED_ALERT_JOB,
    { bookingId, driverId, payload } satisfies DelayedAlertJobData,
    {
      delay: RESPONSE_WINDOW_MS,
      // See the note on schedulePenaltyCheck: ':' is rejected by BullMQ.
      jobId: `delayed-alert-${bookingId}-${driverId}`,
    },
  );
}

async function processPenaltyCheck(data: PenaltyJobData): Promise<void> {
  const booking = await Booking.findById(data.bookingId).lean();
  if (!booking) return;

  // Somebody accepted (or the customer cancelled) — no penalty is due.
  if (booking.status !== 'dispatched') return;

  const trip = await Trip.findOne({ bookingId: booking._id }).lean();
  if (trip) return;

  for (const driverId of data.driverIds) {
    try {
      // The unique (bookingId, driverId) index makes a retried job idempotent.
      await PenaltyEvent.create({
        bookingId: booking._id,
        driverId,
        reason: 'No response to ride alert within the 2-minute window',
        alertDelayMinutes: 2,
      });

      const driver = await Driver.findByIdAndUpdate(
        driverId,
        { $inc: { penaltyCount: 1 } },
        { new: true },
      );

      if (driver) {
        await notify.send(driver.userId, NOTIFICATION_TYPES.PENALTY_APPLIED, {
          message: 'You missed a ride request. Your next ride alerts will be delayed by 2 minutes.',
          bookingId: String(booking._id),
        });
      }
    } catch (err) {
      // Duplicate key simply means this pairing was already penalised.
      if (!isDuplicateKey(err)) throw err;
    }
  }

  logger.info(`Penalty applied for booking ${data.bookingId} to ${data.driverIds.length} driver(s)`);
}

async function processDelayedAlert(data: DelayedAlertJobData): Promise<void> {
  const booking = await Booking.findById(data.bookingId).lean();
  if (!booking || booking.status !== 'dispatched') return; // already taken

  getIo()
    ?.of(ns.dispatch)
    .to(`driver:${data.driverId}`)
    .emit('booking:new', { ...data.payload, delayedByPenalty: true });

  // The persisted half of the ride alert, delayed by the same 2 minutes.
  const driver = await Driver.findById(data.driverId).select('userId').lean();
  if (driver) {
    await notify.send(driver.userId, NOTIFICATION_TYPES.RIDE_OFFER, {
      message: 'A ride is available near you',
      bookingId: data.bookingId,
      delayedByPenalty: true,
    });
  }
}

/** Called once from server.ts during boot. */
export function registerPenaltyWorker(): void {
  registerWorker(QUEUE_NAMES.DISPATCH, async (job: Job) => {
    if (job.name === PENALTY_JOB) return processPenaltyCheck(job.data as PenaltyJobData);
    if (job.name === DELAYED_ALERT_JOB) return processDelayedAlert(job.data as DelayedAlertJobData);
    logger.warn(`Unknown dispatch job '${job.name}'`);
  });
}

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code: unknown }).code === 11000;
}
