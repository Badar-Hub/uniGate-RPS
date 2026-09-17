import { Worker, type Job } from 'bullmq';
import { logger } from '@/logging/logger.js';
import { handleDomainEvent } from '@/modules/notifications/event.subscribers.js';
import { rematchOpenRequests } from '@/modules/demand/rematch.service.js';
import { bullConnection, QUEUE } from './queues.js';

/**
 * Domain event consumers. The notifications module subscribes to the business events
 * (FR-NOTIFICATIONS-03); anything without a subscriber falls through to the log-only handlers. Handlers must be idempotent — BullMQ retries on failure and
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
  // Late invitations (demand/rematch.service): a vehicle or owner that became eligible after publish.
  'vehicle.approved': async (job) => {
    await rematchOpenRequests({ vehicleId: job.data.aggregateId }, 'vehicle.approved');
  },
  'owner.approved': async (job) => {
    await rematchOpenRequests({ ownerProfileId: job.data.aggregateId }, 'owner.approved');
  },
  'owner.service_areas_replaced': async (job) => {
    await rematchOpenRequests({ ownerProfileId: job.data.aggregateId }, 'owner.service_areas_replaced');
  },
};

export function startEventWorker(): Worker<EventJobData> {
  const worker = new Worker<EventJobData>(
    QUEUE.events,
    async (job) => {
      // Notification subscribers and domain handlers are independent: both run for the same event.
      const handled = await handleDomainEvent({ id: job.data.id, eventType: job.name, aggregateType: job.data.aggregateType, aggregateId: job.data.aggregateId, payload: job.data.payload ?? {} });
      const h = handlers[job.name];
      if (h) {
        await h(job);
        return;
      }
      if (!handled) logger().warn({ event: job.name }, 'no handler registered; acknowledging');
    },
    { connection: bullConnection(), concurrency: 5 },
  );
  worker.on('failed', (job, err) => {
    logger().error({ err, event: job?.name, jobId: job?.id }, 'event handler failed');
  });
  return worker;
}
