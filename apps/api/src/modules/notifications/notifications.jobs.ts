import { Worker } from 'bullmq';
import { config } from '@/config/index.js';
import { bullConnection, notificationsJobs, QUEUE } from '@/jobs/queues.js';
import { logger } from '@/logging/logger.js';
import { deliver } from './notification.service.js';

/**
 * Delivery queue (architecture.md §9, concurrency 10). A job carries row ids only — the rendered
 * text and the recipient's address are read from the row at delivery time, so nothing personal
 * sits in Redis. The rows are durable: a lost enqueue is picked up by the sweeper in worker.ts.
 */
export const DELIVER_JOB = 'notifications.deliver';
const ATTEMPTS = 5;

export function enqueueDelivery(ids: string[], delayMs: number): void {
  // Tests deliver inline (the worker is not running); the rows stay QUEUED until deliver() is called.
  if (config().isTest) return;
  notificationsJobs()
    .add(DELIVER_JOB, { ids }, { attempts: ATTEMPTS, delay: delayMs, backoff: { type: 'exponential', delay: 5000 } })
    .catch((err: unknown) => {
      logger().error({ err, count: ids.length }, 'failed to enqueue notification delivery; the sweeper will deliver');
    });
}

export function startNotificationsWorker(): Worker<{ ids: string[] }> {
  const worker = new Worker<{ ids: string[] }>(
    QUEUE.notifications,
    async (job) => {
      const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? ATTEMPTS);
      const r = await deliver(job.data.ids, { finalAttempt });
      if (r.failed.length && !finalAttempt) throw new Error(`${r.failed.length} deliveries failed; retrying`);
    },
    { connection: bullConnection(), concurrency: 10 },
  );
  worker.on('failed', (job, err) => {
    logger().error({ err, jobId: job?.id }, 'notifications job failed');
  });
  return worker;
}
