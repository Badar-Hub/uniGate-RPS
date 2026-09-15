import { Worker } from 'bullmq';
import { bullConnection, paymentsJobs, QUEUE } from '@/jobs/queues.js';
import { logger } from '@/logging/logger.js';
import { processWebhookEvent } from './webhook.service.js';

/**
 * Persist-then-process: the HTTP handler has already answered 200 by the time this runs. The job
 * id is the event row id, so a double enqueue collapses; the processor is idempotent regardless.
 */
export const WEBHOOK_JOB = 'payments.webhook';

export function enqueueWebhookProcessing(eventRowId: string): void {
  paymentsJobs()
    .add(WEBHOOK_JOB, { eventRowId }, { jobId: eventRowId })
    .catch((err: unknown) => {
      // The row is durable; the sweeper picks it up if the enqueue failed.
      logger().error({ err, eventRowId }, 'failed to enqueue webhook processing');
    });
}

export function startPaymentsWorker(): Worker<{ eventRowId: string }> {
  const worker = new Worker<{ eventRowId: string }>(
    QUEUE.payments,
    async (job) => {
      const result = await processWebhookEvent(job.data.eventRowId);
      if (result === 'FAILED') throw new Error(`webhook ${job.data.eventRowId} failed; will retry`);
    },
    { connection: bullConnection(), concurrency: 3 },
  );
  worker.on('failed', (job, err) => {
    logger().error({ err, jobId: job?.id }, 'payments job failed');
  });
  return worker;
}
