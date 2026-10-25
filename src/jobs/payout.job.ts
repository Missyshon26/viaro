import type { Job } from 'bullmq';
import { Wallet } from '../models/Wallet';
import { User } from '../models/User';
import { getQueue, registerWorker, QUEUE_NAMES } from './queues';
import { format, now } from '../config/timezone';
import { round2 } from '../utils/money';
import { logger } from '../utils/logger';
import * as notify from '../modules/notifications/notifications.service';
import { NOTIFICATION_TYPES } from '../modules/notifications/notifications.service';

/**
 * Scheduled payouts (spec §1, §3) — a repeatable weekly run over driver wallets.
 *
 * ⚠ TBD-with-Anvar — this job deliberately does NOT move money.
 *
 * Spec §8 rule 3 defines the 10% fee as a withdrawal charge, and `POST /wallet/withdraw`
 * is a driver-initiated action. An automatic payout run raises a question the spec never
 * answers: does an automatic payout charge that same 10%, or is the fee only the price of
 * withdrawing early? Guessing either way silently changes what every driver earns.
 *
 * So the run does the safe, useful half: it sweeps driver balances at or above the
 * threshold and notifies each driver that their earnings are ready. Turning it into an
 * actual transfer is one call to walletService.withdraw() (or a fee-free variant) inside
 * processPayoutRun, once the fee question is settled.
 */
export const PAYOUT_RUN_JOB = 'scheduled-payout-run';
export const PAYOUT_SCHEDULER_ID = 'weekly-driver-payouts';

/** Minimum balance worth notifying a driver about. */
export const PAYOUT_MINIMUM = 25;

/** Every Monday at 09:00 — the cron runs in APP_TIMEZONE, not the server's zone. */
export const PAYOUT_CRON = '0 9 * * 1';

export async function schedulePayoutRuns(): Promise<void> {
  await getQueue(QUEUE_NAMES.PAYOUT).upsertJobScheduler(
    PAYOUT_SCHEDULER_ID,
    { pattern: PAYOUT_CRON, tz: 'America/Los_Angeles' },
    { name: PAYOUT_RUN_JOB },
  );
}

/** Exposed so ops can trigger a run without waiting for Monday. */
export async function triggerPayoutRunNow(): Promise<string> {
  const job = await getQueue(QUEUE_NAMES.PAYOUT).add(PAYOUT_RUN_JOB, {});
  return String(job.id);
}

async function processPayoutRun(): Promise<{ notified: number; total: number }> {
  const wallets = await Wallet.find({
    ownerType: 'driver',
    balance: { $gte: PAYOUT_MINIMUM },
  }).lean();

  let total = 0;

  for (const wallet of wallets) {
    if (!wallet.ownerId) continue;
    const balance = round2(wallet.balance);
    total += balance;

    const user = await User.findById(wallet.ownerId).select('name').lean();
    if (!user) continue;

    await notify.send(wallet.ownerId, NOTIFICATION_TYPES.PAYOUT_READY, {
      message: `You have ${balance.toFixed(2)} available to withdraw`,
      balance,
      // Stated explicitly so the driver knows the cost before initiating the withdrawal.
      withdrawalFeePct: 10,
      runAt: format(now()),
    });
  }

  logger.info(`Payout run: ${wallets.length} driver(s) notified, ${round2(total)} outstanding`);
  return { notified: wallets.length, total: round2(total) };
}

/** Called once from server.ts during boot. */
export function registerPayoutWorker(): void {
  registerWorker(QUEUE_NAMES.PAYOUT, async (job: Job) => {
    if (job.name === PAYOUT_RUN_JOB) return processPayoutRun();
    logger.warn(`Unknown payout job '${job.name}'`);
  });
}
