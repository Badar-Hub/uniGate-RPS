import { Worker, type Job } from 'bullmq';
import { logger } from '@/logging/logger.js';
import { bullConnection, QUEUE } from './queues.js';

/**
 * Domain event consumers. Phase 3 registers the auth/security events and logs them; the
 * notifications module (OTP path now, full system in Phase 13) replaces the log lines with
 * template-rendered deliveries. Handlers must be idempotent — BullMQ retries on failure and
 * the outbox may (rarely) enqueue twice; the job id is the outbox row id, which dedupes.
 */
interface EventJobData {
  id: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown> | null;
}

type Handler = (job: Job<EventJobData>) => Promise<void>;

const handlers: Record<string, Handler> = {
  'auth.session_opened': async (job) => {
    logger().info(
      { aggregateId: job.data.aggregateId, clientType: job.data.payload?.['clientType'] },
      'event: session opened (new-device notice lands with the notifications module)',
    );
    await Promise.resolve();
  },
  'security.refresh_reuse': async (job) => {
    logger().warn(
      { aggregateId: job.data.aggregateId, sessionId: job.data.payload?.['sessionId'] },
      'event: refresh reuse — account owner to be notified',
    );
    await Promise.resolve();
  },
  'auth.password_reset_requested': async (job) => {
    logger().info({ aggregateId: job.data.aggregateId }, 'event: password reset requested');
    await Promise.resolve();
  },
  'auth.password_changed': async (job) => {
    logger().info({ aggregateId: job.data.aggregateId }, 'event: password changed');
    await Promise.resolve();
  },
  'user.roles_changed': async (job) => {
    logger().info({ aggregateId: job.data.aggregateId }, 'event: roles changed');
    await Promise.resolve();
  },
};

export function startEventWorker(): Worker<EventJobData> {
  const worker = new Worker<EventJobData>(
    QUEUE.events,
    async (job) => {
      const h = handlers[job.name];
      if (!h) {
        logger().warn({ event: job.name }, 'no handler registered; acknowledging');
        return;
      }
      await h(job);
    },
    { connection: bullConnection(), concurrency: 5 },
  );
  worker.on('failed', (job, err) => {
    logger().error({ err, event: job?.name, jobId: job?.id }, 'event handler failed');
  });
  return worker;
}
