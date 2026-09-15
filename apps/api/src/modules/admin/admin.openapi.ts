/** OpenAPI registrations for /admin/* (api.md §8.29). */
import { z } from 'zod';
import { adminDashboardQuery, adminDashboardSeriesQuery, idParams, listOutboxQuery, listWebhookEventsQuery } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const bearer = [{ bearerAuth: [] }];
const ts = z.string().datetime();
const money = z.string().regex(/^-?\d+\.\d{2}$/);

const dashboard = z.object({
  dateFrom: z.string(), dateTo: z.string(), transportType: z.string().nullable(), currency: z.string(), users: z.number().int(), customers: z.number().int(), owners: z.number().int(), drivers: z.number().int(), vehicles: z.number().int(), activeVehicles: z.number().int(),
  tripRequests: z.number().int(), bids: z.number().int(), bookings: z.number().int(), activeTrips: z.number().int(), completedTrips: z.number().int(), cancelledBookings: z.number().int(), grossBookingValue: money, platformCommission: money, pendingSettlements: money, openComplaints: z.number().int(), computedAt: ts,
}).openapi('AdminDashboard');
const series = z.object({ bucket: z.string(), transportType: z.string().nullable(), currency: z.string(), points: z.array(z.object({ bucket: z.string(), tripRequests: z.number().int(), bookings: z.number().int(), completedTrips: z.number().int(), cancelledBookings: z.number().int(), grossBookingValue: money, platformCommission: money })) }).openapi('AdminDashboardSeries');
const queue = z.object({ name: z.string(), waiting: z.number().int(), active: z.number().int(), delayed: z.number().int(), failed: z.number().int(), completed: z.number().int(), reachable: z.boolean() });
const outboxStats = z.object({ pending: z.number().int(), failed: z.number().int(), oldestPendingAt: ts.nullable() });
const queues = z.object({ queues: z.array(queue), outbox: outboxStats, computedAt: ts }).openapi('SystemQueues');
const check = z.object({ ok: z.boolean(), latencyMs: z.number().int(), error: z.string().nullable() });
const health = z.object({ status: z.enum(['ok', 'degraded', 'down']), version: z.string(), environment: z.string(), migration: z.string().nullable(), checks: z.object({ database: check, redis: check, storage: check }), queues: z.array(queue), outbox: outboxStats, oldestUnprocessedWebhookAt: ts.nullable(), providers: z.record(z.string(), z.string()), computedAt: ts }).openapi('SystemHealth');
const webhook = z.object({ id: z.string().uuid(), providerCode: z.string(), providerEventId: z.string(), eventType: z.string(), signatureValid: z.boolean(), receivedAt: ts, processingStatus: z.string(), processedAt: ts.nullable(), attemptCount: z.number().int(), lastError: z.string().nullable(), relatedPaymentId: z.string().uuid().nullable() }).openapi('PaymentWebhookEvent');
const outbox = z.object({ id: z.string().uuid(), aggregateType: z.string(), aggregateId: z.string(), eventType: z.string(), status: z.string(), attemptCount: z.number().int(), lastError: z.string().nullable(), availableAt: ts, publishedAt: ts.nullable(), createdAt: ts }).openapi('OutboxEvent');

registry.registerPath({ method: 'get', path: '/admin/dashboard', tags: ['admin'], summary: 'BRIEF-§24 KPI block for a date range (60-second cache; optional transportType for the per-vertical view)', security: bearer, request: { query: adminDashboardQuery }, responses: { 200: ok(dashboard, 'AdminDashboardEnvelope') } });
registry.registerPath({ method: 'get', path: '/admin/dashboard/series', tags: ['admin'], summary: 'Time series for the same measures, bucketed day / week / month', security: bearer, request: { query: adminDashboardSeriesQuery }, responses: { 200: ok(series, 'AdminDashboardSeriesEnvelope') } });
registry.registerPath({ method: 'get', path: '/admin/system/health', tags: ['admin'], summary: 'Deep health: DB, Redis, storage, queue depths, outbox backlog, oldest unprocessed webhook, migration version, provider codes', security: bearer, responses: { 200: ok(health, 'SystemHealthEnvelope') } });
registry.registerPath({ method: 'get', path: '/admin/system/queues', tags: ['admin'], summary: 'BullMQ depth and failure counts plus the outbox backlog', security: bearer, responses: { 200: ok(queues, 'SystemQueuesEnvelope') } });
registry.registerPath({ method: 'get', path: '/admin/webhooks/payments', tags: ['admin'], summary: 'Stored gateway callbacks with signature validity and processing status', security: bearer, request: { query: listWebhookEventsQuery }, responses: { 200: ok(z.array(webhook), 'PaymentWebhookEventListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/admin/webhooks/payments/{id}/replay', tags: ['admin'], summary: 'Re-run the idempotent handler for a stored event; refused for signature_valid = false', security: bearer, request: { params: idParams }, responses: { 200: ok(webhook.extend({ result: z.string() }), 'PaymentWebhookReplayEnvelope'), 422: err('WEBHOOK_SIGNATURE_INVALID') } });
registry.registerPath({ method: 'get', path: '/admin/outbox', tags: ['admin'], summary: 'Outbox rows by status / event type', security: bearer, request: { query: listOutboxQuery }, responses: { 200: ok(z.array(outbox), 'OutboxEventListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/admin/outbox/{id}/retry', tags: ['admin'], summary: 'Reset a FAILED outbox row to PENDING', security: bearer, request: { params: idParams }, responses: { 200: ok(outbox, 'OutboxEventEnvelope'), 422: err('OUTBOX_EVENT_NOT_FAILED') } });
