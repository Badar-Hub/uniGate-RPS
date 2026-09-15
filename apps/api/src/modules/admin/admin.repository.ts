import { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Admin reads (api.md §8.29): dashboard KPIs and series, payment webhook events, outbox rows.
 * Everything here is GLOBAL — the routes gate on dashboard.read / payments.manage /
 * platform.jobs.manage before a scope reaches this file.
 */

export interface KpiRow {
  users: bigint; customers: bigint; owners: bigint; drivers: bigint; vehicles: bigint; active_vehicles: bigint;
  trip_requests: bigint; bids: bigint; bookings: bigint; active_trips: bigint; completed_trips: bigint; cancelled_bookings: bigint;
  gross_booking_value: string | null; platform_commission: string | null; pending_settlements: string | null; open_complaints: bigint;
}

// @raw-sql-reviewed: aggregate counts over a bounded range; the transport-type filter is a bound parameter.
export async function kpis(_scope: AnyScope, from: Date, to: Date, transportType: string | null): Promise<KpiRow> {
  const tt = transportType ? Prisma.sql`AND transport_type = ${transportType}::transport_type` : Prisma.empty;
  const ttb = transportType ? Prisma.sql`AND b.transport_type = ${transportType}::transport_type` : Prisma.empty;
  const rows = await prisma().$queryRaw<KpiRow[]>`
    SELECT
      (SELECT COUNT(*) FROM users WHERE status = 'ACTIVE') AS users,
      (SELECT COUNT(*) FROM customer_profiles) AS customers,
      (SELECT COUNT(*) FROM owner_profiles WHERE onboarding_status = 'APPROVED') AS owners,
      (SELECT COUNT(*) FROM driver_profiles WHERE approval_status = 'APPROVED') AS drivers,
      (SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL) AS vehicles,
      (SELECT COUNT(*) FROM vehicles WHERE deleted_at IS NULL AND approval_status = 'APPROVED' AND lifecycle_status = 'ACTIVE') AS active_vehicles,
      (SELECT COUNT(*) FROM trip_requests WHERE created_at >= ${from} AND created_at < ${to} ${tt}) AS trip_requests,
      (SELECT COUNT(*) FROM bids WHERE created_at >= ${from} AND created_at < ${to}) AS bids,
      (SELECT COUNT(*) FROM bookings b WHERE b.created_at >= ${from} AND b.created_at < ${to} ${ttb}) AS bookings,
      (SELECT COUNT(*) FROM trips t WHERE t.status IN ('DRIVER_EN_ROUTE', 'ARRIVED_AT_PICKUP', 'TRIP_STARTED', 'IN_PROGRESS', 'LOADING', 'LOADED', 'IN_TRANSIT', 'ARRIVED_AT_DESTINATION', 'UNLOADING') ${tt}) AS active_trips,
      (SELECT COUNT(*) FROM trips t WHERE t.status = 'COMPLETED' AND t.actual_end_at >= ${from} AND t.actual_end_at < ${to} ${tt}) AS completed_trips,
      (SELECT COUNT(*) FROM bookings b WHERE b.status = 'CANCELLED' AND b.cancelled_at >= ${from} AND b.cancelled_at < ${to} ${ttb}) AS cancelled_bookings,
      (SELECT COALESCE(SUM(b.total_amount), 0)::text FROM bookings b WHERE b.created_at >= ${from} AND b.created_at < ${to} AND b.status NOT IN ('CANCELLED', 'REFUNDED') ${ttb}) AS gross_booking_value,
      (SELECT COALESCE(SUM(f.commission_amount), 0)::text FROM booking_financial_snapshots f JOIN bookings b ON b.id = f.booking_id WHERE b.status = 'COMPLETED' AND b.completed_at >= ${from} AND b.completed_at < ${to} ${ttb}) AS platform_commission,
      (SELECT COALESCE(SUM(net_payable_amount), 0)::text FROM settlements WHERE status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PROCESSING')) AS pending_settlements,
      (SELECT COUNT(*) FROM complaints WHERE status IN ('OPEN', 'IN_REVIEW', 'AWAITING_RESPONSE')) AS open_complaints`;
  const r = rows[0];
  if (!r) throw new Error('kpi query returned no row');
  return r;
}

export interface SeriesRow {
  bucket: Date;
  trip_requests: bigint;
  bookings: bigint;
  completed_trips: bigint;
  cancelled_bookings: bigint;
  gross_booking_value: string | null;
  platform_commission: string | null;
}

// @raw-sql-reviewed: date_trunc unit is whitelisted by the validator (day|week|month) and interpolated as a literal.
export async function series(_scope: AnyScope, from: Date, to: Date, unit: 'day' | 'week' | 'month', transportType: string | null): Promise<SeriesRow[]> {
  const ttb = transportType ? Prisma.sql`AND b.transport_type = ${transportType}::transport_type` : Prisma.empty;
  const tt = transportType ? Prisma.sql`AND transport_type = ${transportType}::transport_type` : Prisma.empty;
  const trunc = Prisma.raw(`'${unit}'`);
  return prisma().$queryRaw<SeriesRow[]>`
    WITH buckets AS (SELECT generate_series(date_trunc(${trunc}, ${from}::timestamptz), date_trunc(${trunc}, ${to}::timestamptz), (${Prisma.raw(`'1 ${unit}'`)})::interval) AS bucket)
    SELECT bk.bucket,
      (SELECT COUNT(*) FROM trip_requests r WHERE date_trunc(${trunc}, r.created_at) = bk.bucket ${tt}) AS trip_requests,
      (SELECT COUNT(*) FROM bookings b WHERE date_trunc(${trunc}, b.created_at) = bk.bucket ${ttb}) AS bookings,
      (SELECT COUNT(*) FROM trips t WHERE t.status = 'COMPLETED' AND date_trunc(${trunc}, t.actual_end_at) = bk.bucket ${tt}) AS completed_trips,
      (SELECT COUNT(*) FROM bookings b WHERE b.status = 'CANCELLED' AND date_trunc(${trunc}, b.cancelled_at) = bk.bucket ${ttb}) AS cancelled_bookings,
      (SELECT COALESCE(SUM(b.total_amount), 0)::text FROM bookings b WHERE date_trunc(${trunc}, b.created_at) = bk.bucket AND b.status NOT IN ('CANCELLED', 'REFUNDED') ${ttb}) AS gross_booking_value,
      (SELECT COALESCE(SUM(f.commission_amount), 0)::text FROM booking_financial_snapshots f JOIN bookings b ON b.id = f.booking_id WHERE b.status = 'COMPLETED' AND date_trunc(${trunc}, b.completed_at) = bk.bucket ${ttb}) AS platform_commission
    FROM buckets bk
    WHERE bk.bucket < ${to}::timestamptz
    ORDER BY bk.bucket`;
}

// ── system ───────────────────────────────────────────────────────────────────

export async function outboxStats(_scope: AnyScope): Promise<{ pending: number; failed: number; oldestPendingAt: Date | null }> {
  const [pending, failed, oldest] = await Promise.all([
    prisma().outboxEvent.count({ where: { status: 'PENDING' } }),
    prisma().outboxEvent.count({ where: { status: 'FAILED' } }),
    prisma().outboxEvent.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
  ]);
  return { pending, failed, oldestPendingAt: oldest?.createdAt ?? null };
}

export async function oldestUnprocessedWebhook(_scope: AnyScope): Promise<Date | null> {
  const r = await prisma().paymentWebhookEvent.findFirst({ where: { processingStatus: { in: ['RECEIVED', 'FAILED'] }, signatureValid: true }, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } });
  return r?.receivedAt ?? null;
}

// @raw-sql-reviewed: reads Prisma's own migration ledger; no parameters.
export async function migrationVersion(_scope: AnyScope): Promise<string | null> {
  const rows = await prisma().$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`;
  return rows[0]?.migration_name ?? null;
}

export const webhookSelect = { id: true, providerCode: true, providerEventId: true, eventType: true, signatureValid: true, receivedAt: true, processingStatus: true, processedAt: true, attemptCount: true, lastError: true, relatedPaymentId: true } satisfies Prisma.PaymentWebhookEventSelect;
export type WebhookRow = Prisma.PaymentWebhookEventGetPayload<{ select: typeof webhookSelect }>;

export async function listWebhooks(_scope: AnyScope, f: { providerCode?: string | undefined; processingStatus?: string | undefined; signatureValid?: boolean | undefined; dateFrom?: string | undefined; dateTo?: string | undefined }, page: { page: number; pageSize: number }): Promise<{ items: WebhookRow[]; total: number }> {
  const where: Prisma.PaymentWebhookEventWhereInput = {
    ...(f.providerCode ? { providerCode: f.providerCode } : {}), ...(f.processingStatus ? { processingStatus: f.processingStatus as WebhookRow['processingStatus'] } : {}), ...(f.signatureValid !== undefined ? { signatureValid: f.signatureValid } : {}),
    ...(f.dateFrom || f.dateTo ? { receivedAt: { ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}), ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}) } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma().paymentWebhookEvent.findMany({ where, select: webhookSelect, orderBy: { receivedAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().paymentWebhookEvent.count({ where }),
  ]);
  return { items, total };
}

export async function findWebhook(_scope: AnyScope, id: string): Promise<WebhookRow | null> {
  return prisma().paymentWebhookEvent.findUnique({ where: { id }, select: webhookSelect });
}

export async function resetWebhookForReplay(_scope: AnyScope, id: string): Promise<void> {
  await prisma().paymentWebhookEvent.update({ where: { id }, data: { processingStatus: 'RECEIVED', lastError: null } });
}

export const outboxSelect = { id: true, aggregateType: true, aggregateId: true, eventType: true, status: true, attemptCount: true, lastError: true, availableAt: true, publishedAt: true, createdAt: true } satisfies Prisma.OutboxEventSelect;
export type OutboxRow = Prisma.OutboxEventGetPayload<{ select: typeof outboxSelect }>;

export async function listOutbox(_scope: AnyScope, f: { status?: string | undefined; eventType?: string | undefined }, page: { page: number; pageSize: number }): Promise<{ items: OutboxRow[]; total: number }> {
  const where: Prisma.OutboxEventWhereInput = { ...(f.status ? { status: f.status as OutboxRow['status'] } : {}), ...(f.eventType ? { eventType: f.eventType } : {}) };
  const [items, total] = await Promise.all([
    prisma().outboxEvent.findMany({ where, select: outboxSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().outboxEvent.count({ where }),
  ]);
  return { items, total };
}

export async function retryOutbox(_scope: AnyScope, id: string): Promise<OutboxRow | null> {
  const r = await prisma().outboxEvent.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'PENDING', attemptCount: 0, lastError: null, availableAt: new Date() } });
  if (r.count === 0) return null;
  return prisma().outboxEvent.findUnique({ where: { id }, select: outboxSelect });
}
