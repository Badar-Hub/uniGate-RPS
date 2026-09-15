import { prisma } from '@/database/prisma.js';
import { logger } from '@/logging/logger.js';
import { events } from './queues.js';

const BATCH = 100;
const MAX_ATTEMPTS = 10;

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: unknown;
  attempt_count: number;
}

/**
 * Polls outbox_events (PENDING, available_at <= now) with SKIP LOCKED so several workers can
 * run, enqueues each to BullMQ, marks PUBLISHED. On enqueue failure the attempt count is
 * bumped with exponential back-off; after MAX_ATTEMPTS the row is FAILED and logged at error.
 */
export async function relayOnce(): Promise<number> {
  const rows = await prisma().$queryRaw<OutboxRow[]>`
    SELECT id, aggregate_type, aggregate_id, event_type, payload, attempt_count
    FROM outbox_events
    WHERE status = 'PENDING' AND available_at <= now()
    ORDER BY created_at
    LIMIT ${BATCH}
    FOR UPDATE SKIP LOCKED`;
  let published = 0;
  for (const row of rows) {
    try {
      await events().add(
        row.event_type,
        { id: row.id, aggregateType: row.aggregate_type, aggregateId: row.aggregate_id, payload: row.payload },
        { jobId: row.id },
      );
      await prisma().outboxEvent.update({
        where: { id: row.id },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      published++;
    } catch (err) {
      const attempts = row.attempt_count + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      await prisma().outboxEvent.update({
        where: { id: row.id },
        data: {
          attemptCount: attempts,
          lastError: err instanceof Error ? err.message : String(err),
          status: failed ? 'FAILED' : 'PENDING',
          availableAt: new Date(Date.now() + Math.min(2 ** attempts, 300) * 1000),
        },
      });
      logger().error({ err, eventId: row.id, attempts, failed }, 'outbox relay: enqueue failed');
    }
  }
  return published;
}

export function startOutboxRelay(intervalMs = 1000): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    relayOnce()
      .catch((err: unknown) => {
        logger().error({ err }, 'outbox relay tick failed');
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  return () => {
    clearInterval(timer);
  };
}
