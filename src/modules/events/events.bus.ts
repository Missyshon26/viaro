import { EventEmitter } from 'node:events';
import type { UserRole } from '../../utils/roles';
import { now, toISO } from '../../config/timezone';
import { logger } from '../../utils/logger';

/**
 * In-process fan-out for "something changed" announcements.
 *
 * The point is not to move data — every subscriber re-reads through the normal REST
 * endpoints, so nothing here can leak a field a role is not allowed to see. The point is
 * only to say *that* a thing changed, so an open screen stops waiting for its next poll.
 *
 * Deliberately in-process. A single Node instance is what this deployment is; putting it
 * on Redis pub/sub would be the change needed to run more than one, and the emit sites
 * would not have to move — only this file.
 */

/**
 * What changed. Kept coarse on purpose: a console does not want to reason about which of
 * eleven fields moved, it wants to know its list is stale.
 */
export const CHANGE_TOPICS = [
  'booking',
  'trip',
  'dispatch',
  'driver',
  'user',
  'vehicle',
  'wallet',
  'notification',
  'chat',
] as const;

export type ChangeTopic = (typeof CHANGE_TOPICS)[number];

export interface ChangeEvent {
  topic: ChangeTopic;
  /** Free-form verb for logging and for clients that want to be precise. */
  action: string;
  /** The document the change is about, when there is a single one. */
  id?: string;
  /**
   * Who should hear about it.
   *
   * `roles` is a broadcast to every connected session holding one of them — how
   * operations screens stay current. `userIds` is a direct address, for the passenger
   * and the chauffeur actually on the job. A subscriber matching either one is notified;
   * an event with neither reaches nobody, which is a bug, not a broadcast.
   */
  roles?: UserRole[];
  userIds?: string[];
  at: string;
}

const emitter = new EventEmitter();
// One listener per connected stream; the default ceiling of 10 is a console with a
// handful of operators open, which is exactly the normal case.
emitter.setMaxListeners(0);

const CHANNEL = 'change';

/**
 * Announce a change. Never throws: a failed notification must not fail the write that
 * caused it, because the write is the thing the user asked for.
 */
export function publish(event: Omit<ChangeEvent, 'at'>): void {
  if (!event.roles?.length && !event.userIds?.length) {
    logger.warn(`Change event '${event.topic}:${event.action}' has no audience; dropped`);
    return;
  }

  try {
    // Same rule as every other stored/emitted timestamp — through the shared helper.
    emitter.emit(CHANNEL, { ...event, at: toISO(now()) } satisfies ChangeEvent);
  } catch (err) {
    logger.warn(`Could not publish change event '${event.topic}:${event.action}'`, err);
  }
}

/**
 * Subscribes until the returned function is called.
 *
 * Each listener is isolated: EventEmitter calls them in order and stops at the first
 * throw, so one wedged stream would otherwise silence every subscriber registered after
 * it. A subscriber that fails loses its own notification and nobody else's.
 */
export function subscribe(listener: (event: ChangeEvent) => void): () => void {
  const guarded = (event: ChangeEvent) => {
    try {
      listener(event);
    } catch (err) {
      logger.warn('A change-event subscriber threw; the others are unaffected', err);
    }
  };

  emitter.on(CHANNEL, guarded);
  return () => emitter.off(CHANNEL, guarded);
}

/** True when this viewer is one of the event's intended recipients. */
export function isAddressedTo(
  event: ChangeEvent,
  viewer: { userId: string; role: UserRole },
): boolean {
  if (event.userIds?.includes(viewer.userId)) return true;
  return Boolean(event.roles?.includes(viewer.role));
}

/** Live stream count, for the health endpoint. */
export function subscriberCount(): number {
  return emitter.listenerCount(CHANNEL);
}
