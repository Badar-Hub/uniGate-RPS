import type { Prisma } from '@prisma/client';
import { newId } from '@/common/ids.js';
import { redact } from '@/common/redact.js';
import { prisma } from '@/database/prisma.js';

/**
 * Transactional outbox (architecture.md §9). The event row is written INSIDE the business
 * transaction when a `tx` is supplied, so "bid accepted → owner notified" survives a crash
 * between commit and enqueue. The relay in jobs/outbox.relay.ts publishes to BullMQ.
 *
 * Payloads pass through redact(): an outbox row is durable and readable by operators, so it
 * must never carry a secret, a token or PII ciphertext. One-time links (password reset) are
 * therefore NOT put in the payload; the consumer re-derives what it needs from the aggregate.
 */
export async function publishEvent(
  aggregateType: string,
  aggregateId: string,
  eventType: string,
  payload: Record<string, unknown>,
  tx?: Prisma.TransactionClient,
): Promise<string> {
  const id = newId();
  const db = tx ?? prisma();
  await db.outboxEvent.create({
    data: {
      id,
      aggregateType,
      aggregateId,
      eventType,
      payload: redact(payload) as Prisma.InputJsonValue,
      status: 'PENDING',
      availableAt: new Date(),
    },
  });
  return id;
}
