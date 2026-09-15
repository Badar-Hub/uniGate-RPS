import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, RefundDto } from '@unigate/types';
import type { createRefundBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError, UpstreamError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { type Decimal, money, round2 } from '@/common/money.js';
import { redact } from '@/common/redact.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { paymentGateway } from '@/integrations/payments/index.js';
import { logger } from '@/logging/logger.js';
import { applyRefundCompleted, bookingForPayment } from '@/modules/bookings/booking.service.js';
import { postLedger } from '@/modules/finance/ledger.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { toRefundDto } from './payments.mapper.js';
import * as repo from './payment.repository.js';

/**
 * Refunds (api.md §8.18): REQUESTED → APPROVED (four-eyes) → PROCESSING (gateway call) →
 * COMPLETED / FAILED (gateway webhook). Σ refunds ≤ captured is asserted under the payment's row
 * lock. A refund that moves money on the same request as a cancellation would couple two failure
 * domains, so cancellation only *requests* one.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'refunds', requestId: 'internal' };

export async function getRefund(scope: AnyScope, id: string): Promise<RefundDto> {
  const r = await repo.findRefund(scope, id);
  if (!r) throw new NotFoundError();
  return toRefundDto(r);
}

export async function listRefunds(scope: AnyScope, f: repo.RefundFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listRefunds(scope, f, page);
  return { items: items.map(toRefundDto), total };
}

/** Creates a REQUESTED refund under the payment's lock; used by POST /refunds and by cancellation. */
export async function requestRefund(scope: AnyScope, input: { paymentId: string; amount: Decimal; reasonCode: string; reasonText: string | null; requestedByUserId: string | null }, tx: Prisma.TransactionClient): Promise<string> {
  await repo.lockPayment(scope, input.paymentId, tx);
  const p = await repo.findPayment(scope, input.paymentId, tx);
  if (!p) throw new NotFoundError();
  if (p.status !== 'PAID' && p.status !== 'PARTIALLY_REFUNDED') throw new BusinessRuleError('PAYMENT_NOT_REFUNDABLE', `Payment ${p.paymentNumber} is ${p.status}`, { status: p.status });
  const committed = money(await repo.committedRefundTotal(scope, p.id, tx));
  const amount = round2(input.amount);
  if (committed.add(amount).gt(p.amount)) throw new BusinessRuleError('REFUND_EXCEEDS_CAPTURED', 'Refunds would exceed the captured amount', { captured: p.amount.toFixed(2), alreadyCommitted: committed.toFixed(2), requested: amount.toFixed(2) });
  const id = newId();
  const refundNumber = await repo.nextRefundNumber(scope, tx);
  await tx.refund.create({ data: { id, refundNumber, paymentId: p.id, bookingId: p.bookingId, amount, currency: p.currency, reasonCode: input.reasonCode, reasonText: input.reasonText, status: 'REQUESTED', requestedByUserId: input.requestedByUserId } });
  await writeAudit({ actorUserId: input.requestedByUserId, actorType: input.requestedByUserId ? 'USER' : 'SYSTEM', action: 'refund.requested', entityType: 'refund', entityId: id, afterValue: { refundNumber, paymentId: p.id, amount: amount.toFixed(2), reasonCode: input.reasonCode } }, tx);
  await publishEvent('refund', id, 'refund.requested', { refundNumber, paymentId: p.id, bookingId: p.bookingId, customerProfileId: p.customerProfileId, amount: amount.toFixed(2) }, tx);
  return id;
}

/** POST /refunds (payments.refund, global). */
export async function createRefund(scope: ActorScope, body: z.infer<typeof createRefundBody>): Promise<RefundDto> {
  const id = await prisma().$transaction((tx) => requestRefund(scope, { paymentId: body.paymentId, amount: money(body.amount), reasonCode: body.reasonCode, reasonText: body.reasonText ?? null, requestedByUserId: scope.actor.userId }, tx));
  return getRefund(scope, id);
}

/** Cancellation hook: the captured payment (if any) gets a REQUESTED refund for the refundable amount. */
export async function requestRefundForCancellation(scope: AnyScope, bookingId: string, amount: Decimal, actorUserId: string | null, tx: Prisma.TransactionClient): Promise<{ id: string; refundNumber: string } | null> {
  if (round2(amount).lte(0)) return null;
  const p = await tx.payment.findFirst({ where: { bookingId, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } }, select: { id: true }, orderBy: { paidAt: 'desc' } });
  if (!p) return null;
  const id = await requestRefund(scope, { paymentId: p.id, amount, reasonCode: 'BOOKING_CANCELLED', reasonText: null, requestedByUserId: actorUserId }, tx);
  const r = await tx.refund.findUniqueOrThrow({ where: { id }, select: { id: true, refundNumber: true } });
  return r;
}

/** REQUESTED → APPROVED. Four-eyes: the approver may not be the requester. */
export async function approveRefund(scope: ActorScope, id: string, notes?: string): Promise<RefundDto> {
  const r = await repo.findRefund(scope, id);
  if (!r) throw new NotFoundError();
  if (r.status !== 'REQUESTED') throw new BusinessRuleError('REFUND_INVALID_TRANSITION', `Refund is ${r.status}`, { status: r.status });
  if (r.requestedByUserId && r.requestedByUserId === scope.actor.userId) throw new BusinessRuleError('REFUND_FOUR_EYES', 'A refund cannot be approved by the user who requested it');
  await prisma().$transaction(async (tx) => {
    await tx.refund.update({ where: { id }, data: { status: 'APPROVED', approvedByUserId: scope.actor.userId } });
    await writeAudit({ ...audit(scope), action: 'refund.approved', entityType: 'refund', entityId: id, severity: 'NOTICE', afterValue: { notes: notes ?? null, requestedByUserId: r.requestedByUserId } }, tx);
  });
  return getRefund(scope, id);
}

export async function rejectRefund(scope: ActorScope, id: string, reason: string): Promise<RefundDto> {
  const r = await repo.findRefund(scope, id);
  if (!r) throw new NotFoundError();
  if (r.status !== 'REQUESTED' && r.status !== 'APPROVED') throw new BusinessRuleError('REFUND_INVALID_TRANSITION', `Refund is ${r.status}`, { status: r.status });
  await prisma().$transaction(async (tx) => {
    await tx.refund.update({ where: { id }, data: { status: 'REJECTED', reasonText: r.reasonText ? `${r.reasonText}\n[rejected] ${reason}` : `[rejected] ${reason}` } });
    await writeAudit({ ...audit(scope), action: 'refund.rejected', entityType: 'refund', entityId: id, severity: 'NOTICE', afterValue: { reason } }, tx);
    await publishEvent('refund', id, 'refund.rejected', { refundNumber: r.refundNumber, paymentId: r.paymentId, customerProfileId: r.payment.customerProfileId, reason }, tx);
  });
  return getRefund(scope, id);
}

/** APPROVED → PROCESSING: calls the gateway; the terminal state arrives by webhook. */
export async function processRefund(scope: ActorScope, id: string): Promise<RefundDto> {
  const r = await repo.findRefund(scope, id);
  if (!r) throw new NotFoundError();
  if (r.status === 'PROCESSING' || r.status === 'COMPLETED') throw new ConflictError('REFUND_ALREADY_PROCESSED', `Refund is ${r.status}`);
  if (r.status !== 'APPROVED') throw new BusinessRuleError('REFUND_INVALID_TRANSITION', `Refund must be APPROVED before processing (current: ${r.status})`, { status: r.status });
  if (!r.payment.providerPaymentId) throw new BusinessRuleError('PAYMENT_NOT_REFUNDABLE', 'The payment has no gateway reference');
  const g = paymentGateway();
  try {
    const res = await g.refundPayment({ refundId: r.id, refundNumber: r.refundNumber, providerPaymentId: r.payment.providerPaymentId, amount: r.amount.toFixed(2), currency: r.currency, reason: r.reasonCode });
    await prisma().$transaction(async (tx) => {
      await tx.refund.update({ where: { id }, data: { status: 'PROCESSING', providerRefundId: res.providerRefundId } });
      await tx.paymentTransaction.create({ data: { id: newId(), paymentId: r.paymentId, type: 'REFUND', amount: r.amount, currency: r.currency, status: 'INITIATED', providerTransactionId: res.providerRefundId, responsePayloadRedacted: redact(res.responseRedacted) as Prisma.InputJsonValue } });
      await writeAudit({ ...audit(scope), action: 'refund.processing', entityType: 'refund', entityId: id, afterValue: { providerRefundId: res.providerRefundId } }, tx);
      // A provider that settles synchronously is applied right away; most answer by webhook.
      if (res.state !== 'PROCESSING') await applyRefundOutcome(id, res.state, null, tx);
    });
  } catch (e) {
    logger().error({ err: e, refundId: id }, 'gateway refund failed');
    throw new UpstreamError('PAYMENT_GATEWAY_ERROR', 'The gateway did not accept the refund', { refundId: id });
  }
  return getRefund(scope, id);
}

/**
 * Terminal state from the gateway (webhook or synchronous). COMPLETED reverses the capture postings
 * pro rata and advances the payment and the booking; idempotent.
 */
export async function applyRefundOutcome(refundId: string, outcome: 'COMPLETED' | 'FAILED', failureCode: string | null, tx: Prisma.TransactionClient): Promise<void> {
  const r = await repo.findRefund(systemScope, refundId, tx);
  if (!r) throw new NotFoundError();
  if (r.status === 'COMPLETED' || r.status === 'FAILED' || r.status === 'REJECTED') return;
  await repo.lockPayment(systemScope, r.paymentId, tx);
  const now = new Date();
  if (outcome === 'FAILED') {
    await tx.refund.update({ where: { id: refundId }, data: { status: 'FAILED', processedAt: now } });
    await tx.paymentTransaction.create({ data: { id: newId(), paymentId: r.paymentId, type: 'REFUND', amount: r.amount, currency: r.currency, status: 'FAILED', providerTransactionId: r.providerRefundId, providerResponseCode: failureCode } });
    await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'refund.failed', entityType: 'refund', entityId: refundId, severity: 'WARNING', afterValue: { failureCode } }, tx);
    await publishEvent('refund', refundId, 'refund.failed', { refundNumber: r.refundNumber, paymentId: r.paymentId, customerProfileId: r.payment.customerProfileId, failureCode }, tx);
    return;
  }
  await tx.refund.update({ where: { id: refundId }, data: { status: 'COMPLETED', processedAt: now } });
  await tx.paymentTransaction.create({ data: { id: newId(), paymentId: r.paymentId, type: 'REFUND', amount: r.amount, currency: r.currency, status: 'SUCCEEDED', providerTransactionId: r.providerRefundId } });
  const completed = money(await tx.refund.aggregate({ where: { paymentId: r.paymentId, status: 'COMPLETED' }, _sum: { amount: true } }).then((a) => a._sum.amount?.toString() ?? '0'));
  const fully = completed.gte(r.payment.amount);
  await tx.payment.update({ where: { id: r.paymentId }, data: { status: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } });
  if (r.bookingId) {
    const b = await bookingForPayment(systemScope, r.bookingId, tx);
    if (b?.split) {
      // Reverse the capture pro rata; the last line absorbs rounding so the group balances.
      const ratio = r.amount.div(b.split.grossAmount);
      const owner = round2(b.split.ownerNetAmount.mul(ratio));
      const commission = round2(b.split.commissionAmount.mul(ratio));
      const vat = round2(r.amount.sub(owner).sub(commission));
      await postLedger({ description: `refund ${r.refundNumber} for ${b.bookingNumber}`, occurredAt: now, currency: r.currency, bookingId: b.id, paymentId: r.paymentId, refundId: r.id, lines: [
        { account: 'OWNER_PAYABLE', direction: 'DEBIT', amount: owner, ownerProfileId: b.ownerProfileId },
        { account: 'PLATFORM_COMMISSION_REVENUE', direction: 'DEBIT', amount: commission },
        { account: 'VAT_PAYABLE', direction: 'DEBIT', amount: vat },
        { account: 'CASH_GATEWAY', direction: 'CREDIT', amount: r.amount, customerProfileId: b.customerProfileId },
      ] }, tx);
    }
    await applyRefundCompleted(systemScope, r.bookingId, fully, tx);
  }
  await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'refund.completed', entityType: 'refund', entityId: refundId, afterValue: { amount: r.amount.toFixed(2), paymentStatus: fully ? 'REFUNDED' : 'PARTIALLY_REFUNDED' } }, tx);
  await publishEvent('refund', refundId, 'refund.completed', { refundNumber: r.refundNumber, paymentId: r.paymentId, bookingId: r.bookingId, customerProfileId: r.payment.customerProfileId, amount: r.amount.toFixed(2) }, tx);
}
