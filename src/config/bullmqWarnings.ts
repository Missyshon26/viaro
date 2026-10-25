import { logger } from '../utils/logger';

/**
 * BullMQ warns on every connection it opens that Redis' `maxmemory-policy` is not
 * `noeviction`. With five queues plus their workers that is nine identical lines on
 * every boot, which buries real startup errors — the EADDRINUSE message, for one.
 *
 * The warning is legitimate and is NOT silenced: it is collapsed to a single line the
 * first time, with the context needed to act on it. Repeats are dropped.
 *
 * Why it cannot simply be fixed: the managed Redis this project uses refuses the
 * change (`ERR Unsupported CONFIG parameter: maxmemory-policy`), so the policy has to
 * be set in the provider's dashboard, or a Redis you control has to be used instead.
 *
 * What is actually at risk while the policy is `volatile-lru` — every one of these is
 * stored with a TTL, which is exactly what that policy evicts first under memory
 * pressure:
 *   - BullMQ job state      -> a penalty timer or cancellation-window job never runs
 *   - OTP and reset tokens  -> "expired" long before they should be
 *   - rate-limit counters   -> limits silently reset
 *   - session revocation    -> a revoked session becomes valid again (fails open)
 *
 * Call once, before any queue is constructed.
 */
const EVICTION_WARNING = /Eviction policy is .* It should be "noeviction"/;

let installed = false;
let reported = false;
/**
 * logger.warn writes through console.warn, so the replacement below would otherwise
 * intercept its own summary line — which contains the same text — and drop it.
 */
let emitting = false;

export function collapseBullmqEvictionWarning(): void {
  if (installed) return;
  installed = true;

  const original = console.warn.bind(console);

  console.warn = (...args: unknown[]): void => {
    const first = args[0];

    if (!emitting && typeof first === 'string' && EVICTION_WARNING.test(first)) {
      if (!reported) {
        reported = true;
        emitting = true;
        try {
          logger.warn(
            `${first} — Redis may evict keys with a TTL under memory pressure, which ` +
              `would drop queued jobs, OTP codes, rate-limit counters and session ` +
              `revocations. This provider refuses CONFIG SET, so change it in the ` +
              `Redis dashboard before production. Repeats are suppressed.`,
          );
        } finally {
          emitting = false;
        }
      }
      return;
    }

    original(...args);
  };
}
