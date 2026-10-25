import { Redis, type RedisOptions } from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

/**
 * Redis serves three jobs in this system (spec §1):
 *   1. driver geolocation  — GEOADD / GEOSEARCH on 'drivers:available' (dispatch step)
 *   2. BullMQ backend      — penalty timer, cancellation window, payouts, report exports
 *   3. token blacklist     — logged-out refresh tokens, keyed by jti with a TTL
 *
 * BullMQ requires its own connection with `maxRetriesPerRequest: null`, so queues must
 * use `createRedisConnection()` rather than sharing the app client below.
 */

const baseOptions: RedisOptions = {
  lazyConnect: true,
  retryStrategy: (times: number) => Math.min(times * 200, 5_000),
};

export const redis = new Redis(env.REDIS_URL, baseOptions);

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err: Error) => logger.error('Redis error', err));
redis.on('close', () => logger.warn('Redis connection closed'));

export async function connectRedis(): Promise<Redis> {
  if (redis.status === 'ready' || redis.status === 'connecting') return redis;
  await redis.connect();
  return redis;
}

export async function disconnectRedis(): Promise<void> {
  await redis.quit();
}

/**
 * Dedicated connection factory for BullMQ queues/workers.
 * BullMQ blocks on commands, so it needs `maxRetriesPerRequest: null`.
 */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
