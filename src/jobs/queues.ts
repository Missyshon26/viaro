import { Queue, Worker, type ConnectionOptions, type Processor } from 'bullmq';
import { createRedisConnection } from '../config/redis';
import { logger } from '../utils/logger';

/**
 * BullMQ plumbing (spec §1). Queues and workers each need their own Redis connection
 * with `maxRetriesPerRequest: null` because workers block on the queue — see
 * config/redis.ts createRedisConnection().
 *
 * Connection budget matters here: the managed Redis plan caps concurrent connections,
 * so queues share one connection and only workers (which must block) get their own.
 */
// BullMQ rejects ':' in queue names — it is the Redis key separator it builds with.
export const QUEUE_NAMES = {
  CANCELLATION: 'abl-cancellation',
  PAYOUT: 'abl-payout',
  REPORTS: 'abl-reports',
} as const;

let sharedQueueConnection: ConnectionOptions | null = null;

function queueConnection(): ConnectionOptions {
  if (!sharedQueueConnection) {
    sharedQueueConnection = createRedisConnection() as unknown as ConnectionOptions;
  }
  return sharedQueueConnection;
}

const queues = new Map<string, Queue>();
const workers: Worker[] = [];

export function getQueue(name: string): Queue {
  const existing = queues.get(name);
  if (existing) return existing;

  const queue = new Queue(name, {
    connection: queueConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 500 },
      removeOnFail: { age: 24 * 3_600 },
    },
  });

  queues.set(name, queue);
  return queue;
}

export function registerWorker(name: string, processor: Processor): Worker {
  const worker = new Worker(name, processor, {
    connection: createRedisConnection() as unknown as ConnectionOptions,
    concurrency: 5,
  });

  worker.on('failed', (job, err) => {
    logger.error(`Job ${name}/${job?.name ?? 'unknown'} failed`, err);
  });

  workers.push(worker);
  return worker;
}

export async function closeQueues(): Promise<void> {
  await Promise.all(workers.map((w) => w.close()));
  await Promise.all([...queues.values()].map((q) => q.close()));
}
