import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from '@/config/index.js';

/** One queue per concern. Names are stable identifiers — they appear in Redis. */
export const QUEUE = {
  events: 'unigate-events',
  maintenance: 'unigate-maintenance',
  payments: 'unigate-payments',
} as const;

export function bullConnection(): ConnectionOptions {
  const u = new URL(config().redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: u.password } : {}),
    maxRetriesPerRequest: null,
  };
}

let eventsQueue: Queue | null = null;

export function events(): Queue {
  eventsQueue ??= new Queue(QUEUE.events, {
    connection: bullConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  });
  return eventsQueue;
}

let paymentsQueue: Queue | null = null;

/** Webhook processing jobs (api.md §10 step 5): the job id is the event row id, which dedupes. */
export function paymentsJobs(): Queue {
  paymentsQueue ??= new Queue(QUEUE.payments, {
    connection: bullConnection(),
    defaultJobOptions: { attempts: 8, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 1000, removeOnFail: 5000 },
  });
  return paymentsQueue;
}

export async function closeQueues(): Promise<void> {
  await eventsQueue?.close();
  eventsQueue = null;
  await paymentsQueue?.close();
  paymentsQueue = null;
}
