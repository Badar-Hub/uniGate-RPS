import type { Prisma } from '@prisma/client';
import type { WebhookReceiptDto } from '@unigate/types';
import { NotFoundError, UnauthorizedError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { redact } from '@/common/redact.js';
import { prisma } from '@/database/prisma.js';
import type { WebhookEvent } from '@/integrations/payments/gateway.js';
import { gatewayByCode } from '@/integrations/payments/index.js';
import { logger } from '@/logging/logger.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { applyGatewayOutcome, paymentsSystemScope } from './payment.service.js';
import { applyRefundOutcome } from './refund.service.js';
import * as repo from './payment.repository.js';

/**
 * Inbound gateway webhooks (api.md §10, ADR-005): verify the signature over the raw body →
 * persist (unique on provider + event id) → answer 200 → process in a job. Invalid signatures are
 * stored and alerted on, never processed. Idempotency is the unique index, not a code path.
 */

const HEADER_ALLOW = ['content-type', 'x-signature', 'x-event-id', 'user-agent', 'content-length'];

export interface IngestResult {
  receipt: WebhookReceiptDto;
  /** Set when the row was inserted and is ready for processing. */
  eventRowId: string | null;
}

export async function ingestWebhook(providerCode: string, rawBody: Buffer, headers: Record<string, string | undefined>): Promise<IngestResult> {
  const g = gatewayByCode(providerCode);
  if (!g) throw new NotFoundError('WEBHOOK_UNKNOWN_PROVIDER', `No gateway registered as "${providerCode}"`);
  const v = g.verifyWebhook(rawBody, headers);
  let parsed: WebhookEvent | null = null;
  try {
    parsed = g.parseWebhook(rawBody);
  } catch {
    parsed = null;
  }
  const eventId = (parsed?.eventId ?? '') || (headers['x-event-id'] ?? '') || `unparsed_${newId()}`;
  const valid = v.valid && v.withinReplayWindow && parsed !== null;
  const rowId = newId();
  const kept = Object.fromEntries(Object.entries(headers).filter(([k]) => HEADER_ALLOW.includes(k.toLowerCase())));
  // Evidence rows must never occupy the genuine event's key: a forged delivery carrying a real event id
  // would otherwise block the provider's own delivery as a "duplicate" — a denial-of-payment vector.
  const storedEventId = valid ? eventId : `invalid:${rowId}`;
  const result = await repo.insertWebhookEvent(paymentsSystemScope, {
    id: rowId, providerCode, providerEventId: storedEventId, eventType: parsed?.type ?? 'unparseable', signatureHeader: headers['x-signature'] ?? null, signatureValid: valid,
    rawPayload: redact(parsed?.raw ?? { raw: rawBody.toString('utf8').slice(0, 4000) }) as Prisma.InputJsonValue, httpHeaders: redact(kept),
  });
  if (!valid) {
    // Evidence, not noise: persisted (when first seen) and alerted, then refused.
    logger().warn({ providerCode, eventId, reason: v.reason ?? 'unparseable', duplicate: result === 'duplicate' }, 'webhook rejected');
    await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'payment.webhook_rejected', entityType: 'payment_webhook_event', entityId: rowId, severity: 'WARNING', afterValue: { providerCode, eventId, reason: v.reason ?? 'unparseable' } });
    throw new UnauthorizedError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature verification failed');
  }
  return { receipt: { received: true, eventId, duplicate: result === 'duplicate' }, eventRowId: result === 'inserted' ? rowId : null };
}

/** The job body: load the event, apply it under the payment's lock, mark PROCESSED / IGNORED / FAILED. Idempotent. */
export async function processWebhookEvent(eventRowId: string): Promise<'PROCESSED' | 'IGNORED' | 'FAILED' | 'SKIPPED'> {
  const e = await repo.findWebhookEvent(paymentsSystemScope, eventRowId);
  if (!e || !e.signatureValid || e.processingStatus === 'PROCESSED' || e.processingStatus === 'IGNORED') return 'SKIPPED';
  const g = gatewayByCode(e.providerCode);
  if (!g) return 'SKIPPED';
  await prisma().paymentWebhookEvent.update({ where: { id: e.id }, data: { processingStatus: 'PROCESSING', attemptCount: { increment: 1 } } });
  try {
    const ev = g.parseWebhook(Buffer.from(JSON.stringify(e.rawPayload), 'utf8'));
    const outcome = await prisma().$transaction(async (tx) => {
      if (ev.type.startsWith('refund.')) {
        if (!ev.providerRefundId) return 'IGNORED' as const;
        const r = await repo.findRefundByProviderId(paymentsSystemScope, ev.providerRefundId, tx);
        if (!r) return 'IGNORED' as const;
        await applyRefundOutcome(r.id, ev.type === 'refund.completed' ? 'COMPLETED' : 'FAILED', ev.failureCode, tx);
        await tx.paymentWebhookEvent.update({ where: { id: e.id }, data: { relatedPaymentId: r.paymentId } });
        return 'PROCESSED' as const;
      }
      if (!ev.providerPaymentId || ev.type === 'unknown') return 'IGNORED' as const;
      const p = await repo.findByProviderId(paymentsSystemScope, e.providerCode, ev.providerPaymentId, tx);
      if (!p) return 'IGNORED' as const;
      await tx.paymentWebhookEvent.update({ where: { id: e.id }, data: { relatedPaymentId: p.id } });
      const state = ev.type === 'payment.captured' ? 'PAID' : ev.type === 'payment.authorized' ? 'AUTHORIZED' : ev.type === 'payment.failed' ? 'FAILED' : 'CANCELLED';
      const applied = await applyGatewayOutcome(p.id, { state, last4: ev.last4, methodType: ev.methodType, providerTransactionId: ev.providerTransactionId, failureCode: ev.failureCode, failureMessage: ev.failureMessage, occurredAt: ev.occurredAt, responseRedacted: { eventId: ev.eventId, type: ev.type } }, 'webhook', tx);
      return applied === 'applied' ? ('PROCESSED' as const) : ('IGNORED' as const);
    }, { maxWait: 10_000, timeout: 30_000 });
    await prisma().paymentWebhookEvent.update({ where: { id: e.id }, data: { processingStatus: outcome, processedAt: new Date() } });
    return outcome;
  } catch (err) {
    logger().error({ err, eventRowId }, 'webhook processing failed');
    await prisma().paymentWebhookEvent.update({ where: { id: e.id }, data: { processingStatus: 'FAILED', lastError: err instanceof Error ? err.message.slice(0, 1000) : String(err) } });
    return 'FAILED';
  }
}

/** Sweeper for events whose job never ran (worker down, enqueue failure). */
export async function processPendingWebhooks(): Promise<number> {
  const rows = await repo.listUnprocessedWebhooks(paymentsSystemScope);
  let n = 0;
  for (const r of rows) if ((await processWebhookEvent(r.id)) === 'PROCESSED') n++;
  return n;
}
