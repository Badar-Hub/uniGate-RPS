import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Payments, refunds and webhook events (database.md §12.1–12.2). Scope:
 *   OWN    — the customer's own payments
 *   PARTY  — the customer, or the owner of the booking being paid
 *   GLOBAL — payments.read_any / payments.manage
 */

export const paymentSelect = {
  id: true, paymentNumber: true, bookingId: true, invoiceId: true, customerProfileId: true, purpose: true, amount: true, currency: true, status: true, providerCode: true, providerPaymentId: true,
  paymentMethodType: true, paymentMethodLast4: true, authorizedAt: true, paidAt: true, failedAt: true, failureCode: true, failureMessage: true, expiresAt: true, idempotencyKey: true, metadata: true, createdAt: true, updatedAt: true,
  booking: { select: { bookingNumber: true, ownerProfileId: true, status: true, paymentStatus: true, totalAmount: true, currency: true } },
  refunds: { select: { amount: true, status: true } },
} satisfies Prisma.PaymentSelect;
export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof paymentSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.PaymentWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  const a = scope.actor;
  const or: Prisma.PaymentWhereInput[] = [];
  if (a.customerProfileId) or.push({ customerProfileId: a.customerProfileId });
  if (scope.kind === 'PARTY' && a.ownerProfileId) or.push({ booking: { ownerProfileId: a.ownerProfileId } });
  return or.length ? { OR: or } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findPayment(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<PaymentRow | null> {
  const db = tx ?? prisma();
  return db.payment.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: paymentSelect });
}

export async function findByProviderId(_scope: AnyScope, providerCode: string, providerPaymentId: string, tx: Prisma.TransactionClient | null = null): Promise<PaymentRow | null> {
  const db = tx ?? prisma();
  return db.payment.findFirst({ where: { providerCode, providerPaymentId }, select: paymentSelect });
}

export interface PaymentFilters {
  status?: string | undefined;
  bookingId?: string | undefined;
  invoiceId?: string | undefined;
  customerProfileId?: string | undefined;
  providerCode?: string | undefined;
  paymentMethodType?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  minAmount?: string | undefined;
  maxAmount?: string | undefined;
}

export async function listPayments(scope: AnyScope, f: PaymentFilters, page: { page: number; pageSize: number }): Promise<{ items: PaymentRow[]; total: number }> {
  const where: Prisma.PaymentWhereInput = {
    AND: [
      scopeWhere(scope),
      ...(f.status ? [{ status: f.status as PaymentRow['status'] }] : []),
      ...(f.bookingId ? [{ bookingId: f.bookingId }] : []),
      ...(f.invoiceId ? [{ invoiceId: f.invoiceId }] : []),
      ...(f.customerProfileId ? [{ customerProfileId: f.customerProfileId }] : []),
      ...(f.providerCode ? [{ providerCode: f.providerCode }] : []),
      ...(f.paymentMethodType ? [{ paymentMethodType: f.paymentMethodType as PaymentRow['paymentMethodType'] }] : []),
      ...(f.dateFrom || f.dateTo ? [{ createdAt: { ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}), ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}) } }] : []),
      ...(f.minAmount || f.maxAmount ? [{ amount: { ...(f.minAmount ? { gte: f.minAmount } : {}), ...(f.maxAmount ? { lte: f.maxAmount } : {}) } }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().payment.findMany({ where, select: paymentSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().payment.count({ where }),
  ]);
  return { items, total };
}

export async function findPendingForInvoice(_scope: AnyScope, invoiceId: string): Promise<{ id: string; paymentNumber: string } | null> {
  return prisma().payment.findFirst({ where: { invoiceId, status: { in: ['PENDING', 'AUTHORIZED'] } }, select: { id: true, paymentNumber: true } });
}

export async function findPendingForBooking(_scope: AnyScope, bookingId: string): Promise<PaymentRow | null> {
  return prisma().payment.findFirst({ where: { bookingId, status: { in: ['PENDING', 'AUTHORIZED'] } }, select: paymentSelect, orderBy: { createdAt: 'desc' } });
}

export async function nextPaymentNumber(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_payment_number') AS n`;
  return `PY-${new Date().getUTCFullYear()}-${String(rows[0]?.n ?? 0).padStart(6, '0')}`;
}

export async function nextRefundNumber(_scope: AnyScope, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('seq_refund_number') AS n`;
  return `RF-${new Date().getUTCFullYear()}-${String(rows[0]?.n ?? 0).padStart(6, '0')}`;
}

export async function lockPayment(_scope: AnyScope, id: string, tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
  return rows.length === 1;
}

export const transactionSelect = { id: true, type: true, amount: true, currency: true, status: true, providerTransactionId: true, providerResponseCode: true, requestPayloadRedacted: true, responsePayloadRedacted: true, occurredAt: true } satisfies Prisma.PaymentTransactionSelect;
export type TransactionRow = Prisma.PaymentTransactionGetPayload<{ select: typeof transactionSelect }>;

export async function listTransactions(scope: AnyScope, paymentId: string): Promise<TransactionRow[] | null> {
  const p = await prisma().payment.findFirst({ where: { AND: [{ id: paymentId }, scopeWhere(scope)] }, select: { id: true } });
  if (!p) return null;
  return prisma().paymentTransaction.findMany({ where: { paymentId }, select: transactionSelect, orderBy: { occurredAt: 'asc' } });
}

export async function listPendingOlderThan(_scope: AnyScope, olderThan: Date, take = 200): Promise<{ id: string; providerCode: string; providerPaymentId: string | null; expiresAt: Date | null }[]> {
  return prisma().payment.findMany({ where: { status: { in: ['PENDING', 'AUTHORIZED'] }, createdAt: { lt: olderThan } }, select: { id: true, providerCode: true, providerPaymentId: true, expiresAt: true }, take });
}

// ── refunds ──────────────────────────────────────────────────────────────────

export const refundSelect = {
  id: true, refundNumber: true, paymentId: true, bookingId: true, amount: true, currency: true, reasonCode: true, reasonText: true, status: true, requestedByUserId: true, approvedByUserId: true, providerRefundId: true, processedAt: true, createdAt: true, updatedAt: true,
  payment: { select: { paymentNumber: true, customerProfileId: true, providerCode: true, providerPaymentId: true, amount: true, status: true, booking: { select: { bookingNumber: true, ownerProfileId: true } } } },
} satisfies Prisma.RefundSelect;
export type RefundRow = Prisma.RefundGetPayload<{ select: typeof refundSelect }>;

export function refundScopeWhere(scope: AnyScope): Prisma.RefundWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  const a = scope.actor;
  const or: Prisma.RefundWhereInput[] = [];
  if (a.customerProfileId) or.push({ payment: { customerProfileId: a.customerProfileId } });
  if (scope.kind === 'PARTY' && a.ownerProfileId) or.push({ payment: { booking: { ownerProfileId: a.ownerProfileId } } });
  return or.length ? { OR: or } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findRefund(scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null): Promise<RefundRow | null> {
  const db = tx ?? prisma();
  return db.refund.findFirst({ where: { AND: [{ id }, refundScopeWhere(scope)] }, select: refundSelect });
}

export async function findRefundByProviderId(_scope: AnyScope, providerRefundId: string, tx: Prisma.TransactionClient | null = null): Promise<RefundRow | null> {
  const db = tx ?? prisma();
  return db.refund.findFirst({ where: { providerRefundId }, select: refundSelect });
}

export interface RefundFilters {
  status?: string | undefined;
  paymentId?: string | undefined;
  bookingId?: string | undefined;
  reasonCode?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

export async function listRefunds(scope: AnyScope, f: RefundFilters, page: { page: number; pageSize: number }): Promise<{ items: RefundRow[]; total: number }> {
  const where: Prisma.RefundWhereInput = {
    AND: [
      refundScopeWhere(scope),
      ...(f.status ? [{ status: f.status as RefundRow['status'] }] : []),
      ...(f.paymentId ? [{ paymentId: f.paymentId }] : []),
      ...(f.bookingId ? [{ bookingId: f.bookingId }] : []),
      ...(f.reasonCode ? [{ reasonCode: f.reasonCode }] : []),
      ...(f.dateFrom || f.dateTo ? [{ createdAt: { ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}), ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}) } }] : []),
    ],
  };
  const [items, total] = await Promise.all([
    prisma().refund.findMany({ where, select: refundSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().refund.count({ where }),
  ]);
  return { items, total };
}

/** Σ refunds that are live or done against a payment (REQUESTED/APPROVED/PROCESSING/COMPLETED). */
export async function committedRefundTotal(_scope: AnyScope, paymentId: string, tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.$queryRaw<{ total: string | null }[]>`SELECT COALESCE(SUM(amount), 0)::text AS total FROM refunds WHERE payment_id = ${paymentId}::uuid AND status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED')`;
  return rows[0]?.total ?? '0';
}

// ── webhook events ───────────────────────────────────────────────────────────

export interface WebhookInsert {
  id: string;
  providerCode: string;
  providerEventId: string;
  eventType: string;
  signatureHeader: string | null;
  signatureValid: boolean;
  rawPayload: Prisma.InputJsonValue;
  httpHeaders: Prisma.InputJsonValue;
}

/** Persist first; a unique violation on (provider, event id) means "already received". */
export async function insertWebhookEvent(_scope: AnyScope, e: WebhookInsert): Promise<'inserted' | 'duplicate'> {
  const inserted = await prisma().$executeRaw`
    INSERT INTO payment_webhook_events (id, provider_code, provider_event_id, event_type, signature_header, signature_valid, raw_payload, http_headers, processing_status, received_at, attempt_count)
    VALUES (${e.id}::uuid, ${e.providerCode}, ${e.providerEventId}, ${e.eventType}, ${e.signatureHeader}, ${e.signatureValid}, ${JSON.stringify(e.rawPayload)}::jsonb, ${JSON.stringify(e.httpHeaders)}::jsonb, ${e.signatureValid ? 'RECEIVED' : 'IGNORED'}::webhook_processing_status, now(), 0)
    ON CONFLICT (provider_code, provider_event_id) DO NOTHING`;
  return inserted === 1 ? 'inserted' : 'duplicate';
}

export async function findWebhookEvent(_scope: AnyScope, id: string, tx: Prisma.TransactionClient | null = null) {
  const db = tx ?? prisma();
  return db.paymentWebhookEvent.findUnique({ where: { id } });
}

export async function listUnprocessedWebhooks(_scope: AnyScope, take = 100): Promise<{ id: string }[]> {
  return prisma().paymentWebhookEvent.findMany({ where: { processingStatus: 'RECEIVED', signatureValid: true }, select: { id: true }, orderBy: { receivedAt: 'asc' }, take });
}
