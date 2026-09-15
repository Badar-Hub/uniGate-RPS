import type { ActorScope, AnyScope, AdminDashboardDto, AdminDashboardSeriesDto, OutboxEventDto, PaymentWebhookEventDto, SystemHealthDto, SystemQueuesDto } from '@unigate/types';
import type { Queue } from 'bullmq';
import type { adminDashboardQuery, adminDashboardSeriesQuery, listOutboxQuery, listWebhookEventsQuery } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, NotFoundError } from '@/common/errors.js';
import { money, toMoneyString } from '@/common/money.js';
import { cacheGet, cacheSet } from '@/common/throttle.js';
import { config } from '@/config/index.js';
import { prisma } from '@/database/prisma.js';
import { redis } from '@/database/redis.js';
import { storageProvider } from '@/integrations/storage/storage.provider.js';
import { events, notificationsJobs, paymentsJobs } from '@/jobs/queues.js';
import { processWebhookEvent } from '@/modules/payments/webhook.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import * as repo from './admin.repository.js';

/** Admin (api.md §8.29): the BRIEF-§24 KPI block with a 60-second cache, time series, deep health, queues, webhook replay, outbox retry. */

const DASHBOARD_CACHE_SECONDS = 60;

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const n = (v: bigint | number) => Number(v);
const m = (v: string | null) => toMoneyString(money(v ?? 0));

export async function dashboard(scope: AnyScope, q: z.infer<typeof adminDashboardQuery>): Promise<AdminDashboardDto> {
  const from = new Date(q.dateFrom);
  const to = new Date(new Date(q.dateTo).getTime() + 86_400_000);
  const key = `dashboard:${q.dateFrom}:${q.dateTo}:${q.transportType ?? 'ALL'}`;
  const cached = await cacheGet(key);
  if (cached) return JSON.parse(cached) as AdminDashboardDto;
  const r = await repo.kpis(scope, from, to, q.transportType ?? null);
  const dto: AdminDashboardDto = {
    dateFrom: q.dateFrom, dateTo: q.dateTo, transportType: q.transportType ?? null, currency: 'SAR',
    users: n(r.users), customers: n(r.customers), owners: n(r.owners), drivers: n(r.drivers), vehicles: n(r.vehicles), activeVehicles: n(r.active_vehicles),
    tripRequests: n(r.trip_requests), bids: n(r.bids), bookings: n(r.bookings), activeTrips: n(r.active_trips), completedTrips: n(r.completed_trips), cancelledBookings: n(r.cancelled_bookings),
    grossBookingValue: m(r.gross_booking_value), platformCommission: m(r.platform_commission), pendingSettlements: m(r.pending_settlements), openComplaints: n(r.open_complaints),
    computedAt: new Date().toISOString(),
  };
  await cacheSet(key, JSON.stringify(dto), DASHBOARD_CACHE_SECONDS);
  return dto;
}

export async function dashboardSeries(scope: AnyScope, q: z.infer<typeof adminDashboardSeriesQuery>): Promise<AdminDashboardSeriesDto> {
  const from = new Date(q.dateFrom);
  const to = new Date(new Date(q.dateTo).getTime() + 86_400_000);
  const rows = await repo.series(scope, from, to, q.bucket, q.transportType ?? null);
  return {
    bucket: q.bucket, transportType: q.transportType ?? null, currency: 'SAR',
    points: rows.map((r) => ({ bucket: r.bucket.toISOString().slice(0, 10), tripRequests: n(r.trip_requests), bookings: n(r.bookings), completedTrips: n(r.completed_trips), cancelledBookings: n(r.cancelled_bookings), grossBookingValue: m(r.gross_booking_value), platformCommission: m(r.platform_commission) })),
  };
}

// ── system ───────────────────────────────────────────────────────────────────

async function timed<T>(fn: () => Promise<T>, ms = 2000): Promise<{ ok: boolean; latencyMs: number; error: string | null }> {
  const t0 = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => { reject(new Error('timeout')); }, ms))]);
    return { ok: true, latencyMs: Date.now() - t0, error: null };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function queues(scope: AnyScope): Promise<SystemQueuesDto> {
  const counts = async (name: string, q: Queue) => {
    try {
      const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
      return { name, waiting: c['waiting'] ?? 0, active: c['active'] ?? 0, delayed: c['delayed'] ?? 0, failed: c['failed'] ?? 0, completed: c['completed'] ?? 0, reachable: true };
    } catch {
      return { name, waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, reachable: false };
    }
  };
  const [ev, pay, notif, outbox] = await Promise.all([counts('events', events()), counts('payments', paymentsJobs()), counts('notifications', notificationsJobs()), repo.outboxStats(scope)]);
  return { queues: [ev, pay, notif], outbox: { pending: outbox.pending, failed: outbox.failed, oldestPendingAt: outbox.oldestPendingAt?.toISOString() ?? null }, computedAt: new Date().toISOString() };
}

export async function health(scope: AnyScope): Promise<SystemHealthDto> {
  const [db, cache, storage, q, oldestWebhook, migration] = await Promise.all([
    timed(() => prisma().$queryRaw`SELECT 1`),
    timed(async () => {
      const r = redis(config().redisUrl);
      if (r.status !== 'ready') await r.connect().catch(() => undefined);
      await r.ping();
    }),
    timed(() => storageProvider().head(config().storage.bucket, 'healthcheck/.keep'), 4000),
    queues(scope),
    repo.oldestUnprocessedWebhook(scope),
    repo.migrationVersion(scope).catch(() => null),
  ]);
  const ok = db.ok && cache.ok;
  return {
    status: ok ? (storage.ok ? 'ok' : 'degraded') : 'down', version: config().version, environment: config().env, migration,
    checks: { database: db, redis: cache, storage },
    queues: q.queues, outbox: q.outbox, oldestUnprocessedWebhookAt: oldestWebhook?.toISOString() ?? null,
    providers: { payment: config().providers.payment, einvoicing: config().providers.einvoicing, otp: config().providers.otp, email: config().providers.email, sms: config().providers.sms, push: config().providers.push, scan: config().providers.scan },
    computedAt: new Date().toISOString(),
  };
}

// ── payment webhooks ─────────────────────────────────────────────────────────

function toWebhookDto(w: repo.WebhookRow): PaymentWebhookEventDto {
  return { id: w.id, providerCode: w.providerCode, providerEventId: w.providerEventId, eventType: w.eventType, signatureValid: w.signatureValid, receivedAt: w.receivedAt.toISOString(), processingStatus: w.processingStatus, processedAt: w.processedAt?.toISOString() ?? null, attemptCount: w.attemptCount, lastError: w.lastError, relatedPaymentId: w.relatedPaymentId };
}

export async function listWebhookEvents(scope: AnyScope, q: z.infer<typeof listWebhookEventsQuery>): Promise<{ items: PaymentWebhookEventDto[]; total: number }> {
  const { items, total } = await repo.listWebhooks(scope, q, q);
  return { items: items.map(toWebhookDto), total };
}

/** Re-run the handler for a stored event; safe because the processor is idempotent on (provider_code, provider_event_id). */
export async function replayWebhook(scope: ActorScope, id: string): Promise<PaymentWebhookEventDto & { result: string }> {
  const w = await repo.findWebhook(scope, id);
  if (!w) throw new NotFoundError();
  if (!w.signatureValid) throw new BusinessRuleError('WEBHOOK_SIGNATURE_INVALID', 'An event whose signature failed verification is never replayed');
  await repo.resetWebhookForReplay(scope, id);
  const result = await processWebhookEvent(id);
  await writeAudit({ ...audit(scope), action: 'payment_webhook.replayed', entityType: 'payment_webhook_event', entityId: id, severity: 'NOTICE', afterValue: { providerCode: w.providerCode, eventType: w.eventType, result } });
  const after = await repo.findWebhook(scope, id);
  if (!after) throw new NotFoundError();
  return { ...toWebhookDto(after), result };
}

// ── outbox ───────────────────────────────────────────────────────────────────

function toOutboxDto(o: repo.OutboxRow): OutboxEventDto {
  return { id: o.id, aggregateType: o.aggregateType, aggregateId: o.aggregateId, eventType: o.eventType, status: o.status, attemptCount: o.attemptCount, lastError: o.lastError, availableAt: o.availableAt.toISOString(), publishedAt: o.publishedAt?.toISOString() ?? null, createdAt: o.createdAt.toISOString() };
}

export async function listOutbox(scope: AnyScope, q: z.infer<typeof listOutboxQuery>): Promise<{ items: OutboxEventDto[]; total: number }> {
  const { items, total } = await repo.listOutbox(scope, q, q);
  return { items: items.map(toOutboxDto), total };
}

export async function retryOutbox(scope: ActorScope, id: string): Promise<OutboxEventDto> {
  const row = await repo.retryOutbox(scope, id);
  if (!row) throw new BusinessRuleError('OUTBOX_EVENT_NOT_FAILED', 'Only FAILED outbox rows can be retried');
  await writeAudit({ ...audit(scope), action: 'outbox.retried', entityType: 'outbox_event', entityId: id, severity: 'NOTICE', afterValue: { eventType: row.eventType } });
  return toOutboxDto(row);
}
