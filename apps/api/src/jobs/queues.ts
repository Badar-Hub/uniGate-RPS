import { Queue, type ConnectionOptions } from 'bullmq';
import { config } from '@/config/index.js';

/** One queue per concern. Names are stable identifiers — they appear in Redis. */
export const QUEUE = {
  events: 'unigate:events',
  maintenance: 'unigate:maintenance',
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

export async function closeQueues(): Promise<void> {
  await eventsQueue?.close();
  eventsQueue = null;
}
