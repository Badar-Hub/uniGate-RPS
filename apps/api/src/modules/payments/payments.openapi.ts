/** OpenAPI registrations for /payments, /refunds and /webhooks/payments/{provider} (api.md §8.17–§8.18, §10). */
import { z } from 'zod';
import { cancelPaymentBody, createPaymentBody, createRefundBody, idParams, listPaymentsQuery, listRefundsQuery, mockCheckoutBody, providerParams, refundDecisionBody, rejectRefundBody } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const bearer = [{ bearerAuth: [] }];
const money = z.string().regex(/^-?\d+\.\d{2}$/);
const idem = z.object({ 'idempotency-key': z.string().uuid() });

const payment = z
  .object({
    id: z.string().uuid(), paymentNumber: z.string(), bookingId: z.string().uuid().nullable(), bookingNumber: z.string().nullable(), invoiceId: z.string().uuid().nullable(), customerProfileId: z.string().uuid(), purpose: z.string(), amount: money, currency: z.string(), status: z.string(),
    providerCode: z.string(), providerPaymentId: z.string().nullable().openapi({ description: 'Gateway reference — never a token, never a PAN' }), paymentMethodType: z.string().nullable(), paymentMethodLast4: z.string().nullable(),
    authorizedAt: z.string().datetime().nullable(), paidAt: z.string().datetime().nullable(), failedAt: z.string().datetime().nullable(), failureCode: z.string().nullable(), expiresAt: z.string().datetime().nullable(), refundedAmount: money, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('Payment');
const action = z.object({ type: z.enum(['REDIRECT', 'FORM_POST', 'SDK', 'NONE']), url: z.string().nullable(), method: z.enum(['GET', 'POST']).nullable(), fields: z.record(z.string()).nullable(), clientPayload: z.record(z.unknown()).nullable() }).openapi('PaymentAction', { description: 'Opaque to the client' });
const createResult = z.object({ payment, action }).openapi('CreatePaymentResult');
const status = z.object({ id: z.string().uuid(), status: z.string(), paidAt: z.string().datetime().nullable(), failureCode: z.string().nullable(), bookingStatus: z.string().nullable() }).openapi('PaymentStatus');
const transaction = z.object({ id: z.string().uuid(), type: z.string(), amount: money, currency: z.string(), status: z.string(), providerTransactionId: z.string().nullable(), providerResponseCode: z.string().nullable(), requestPayloadRedacted: z.record(z.unknown()).nullable(), responsePayloadRedacted: z.record(z.unknown()).nullable(), occurredAt: z.string().datetime() }).openapi('PaymentTransaction');
const cfg = z.object({ providerCode: z.string(), methodTypes: z.array(z.string()), currency: z.string(), publishableKey: z.string().nullable(), isMock: z.boolean() }).openapi('PaymentConfig', { description: 'Client-safe configuration; never a secret' });
const refund = z
  .object({ id: z.string().uuid(), refundNumber: z.string(), paymentId: z.string().uuid(), paymentNumber: z.string(), bookingId: z.string().uuid().nullable(), bookingNumber: z.string().nullable(), amount: money, currency: z.string(), reasonCode: z.string(), reasonText: z.string().nullable(), status: z.string(), requestedByUserId: z.string().uuid().nullable(), approvedByUserId: z.string().uuid().nullable(), providerRefundId: z.string().nullable(), processedAt: z.string().datetime().nullable(), createdAt: z.string().datetime(), updatedAt: z.string().datetime() })
  .openapi('Refund');
const receipt = z.object({ received: z.boolean(), eventId: z.string(), duplicate: z.boolean() }).openapi('WebhookReceipt');

registry.registerPath({ method: 'get', path: '/payments/config', tags: ['payments'], summary: 'Client-safe gateway configuration — enabled methods, provider, currency, publishable key; never a secret', security: bearer, responses: { 200: ok(cfg, 'PaymentConfigEnvelope') } });
registry.registerPath({ method: 'get', path: '/payments', tags: ['payments'], summary: 'Own payments (customer) or all with payments.read_any', security: bearer, request: { query: listPaymentsQuery }, responses: { 200: ok(z.array(payment), 'PaymentListEnvelope', 'OK — paginated') } });
registry.registerPath({
  method: 'post', path: '/payments', tags: ['payments'], summary: 'Initiate a payment for a booking: creates a PENDING intent and returns the gateway action. No client can mark a payment paid. Idempotency-Key required', security: bearer,
  request: { headers: idem, body: json(createPaymentBody) },
  responses: { 201: ok(createResult, 'CreatePaymentResultEnvelope', 'Intent created'), 409: err('PAYMENT_ALREADY_CAPTURED / PAYMENT_ALREADY_PENDING'), 422: err('VALIDATION_FAILED (exactly one target) / PAYMENT_AMOUNT_MISMATCH / PAYMENT_METHOD_UNSUPPORTED / PAYMENT_RETURN_URL_NOT_ALLOWED / BOOKING_INVALID_TRANSITION'), 501: err('INVOICE_PAYMENTS_NOT_AVAILABLE'), 502: err('PAYMENT_GATEWAY_ERROR — the row stays PENDING for reconciliation') },
});
registry.registerPath({ method: 'get', path: '/payments/{id}', tags: ['payments'], summary: 'Payment aggregate (party → global)', security: bearer, request: { params: idParams }, responses: { 200: ok(payment, 'PaymentEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'get', path: '/payments/{id}/status', tags: ['payments'], summary: 'Lightweight poll for the return page — local state only, never the gateway', security: bearer, request: { params: idParams }, responses: { 200: ok(status, 'PaymentStatusEnvelope') } });
registry.registerPath({ method: 'get', path: '/payments/{id}/transactions', tags: ['payments'], summary: 'Attempt log with redacted payloads (payments.read_any)', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(transaction), 'PaymentTransactionListEnvelope') } });
registry.registerPath({ method: 'post', path: '/payments/{id}/sync', tags: ['payments'], summary: 'Server-to-server reconciliation against PaymentGateway.getPaymentStatus() (payments.manage)', security: bearer, request: { params: idParams }, responses: { 200: ok(payment, 'PaymentEnvelope'), 502: err('PAYMENT_GATEWAY_ERROR') } });
registry.registerPath({ method: 'post', path: '/payments/{id}/cancel', tags: ['payments'], summary: 'Cancel a PENDING/AUTHORIZED payment (abandoned checkout)', security: bearer, request: { params: idParams, body: json(cancelPaymentBody) }, responses: { 200: ok(payment, 'PaymentEnvelope'), 409: err('PAYMENT_ALREADY_CAPTURED'), 422: err('PAYMENT_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/payments/mock/checkout/{providerPaymentId}', tags: ['payments'], summary: 'DEVELOPMENT ONLY — drive the MockGateway checkout to an outcome; the gateway then delivers its signed webhook to this API. 404 outside the mock/non-production', security: bearer, request: { params: z.object({ providerPaymentId: z.string() }), body: json(mockCheckoutBody) }, responses: { 200: ok(z.object({ outcome: z.string(), delivered: z.array(receipt) }), 'MockCheckoutEnvelope') } });
registry.registerPath({
  method: 'post', path: '/webhooks/payments/{provider}', tags: ['webhooks'], summary: 'Gateway callback — no session; HMAC over the raw body; persisted first (unique per provider + event id), 200 immediately, processed by a job',
  request: { params: providerParams, headers: z.object({ 'x-signature': z.string(), 'x-event-id': z.string().optional() }) },
  responses: { 200: ok(receipt, 'WebhookReceiptEnvelope', 'Received (duplicate: true on redelivery)'), 401: err('WEBHOOK_SIGNATURE_INVALID — stored and alerted, never processed'), 404: err('WEBHOOK_UNKNOWN_PROVIDER') },
});
registry.registerPath({ method: 'get', path: '/refunds', tags: ['refunds'], summary: 'Own refunds (customer) or all with payments.read_any', security: bearer, request: { query: listRefundsQuery }, responses: { 200: ok(z.array(refund), 'RefundListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/refunds', tags: ['refunds'], summary: 'Create a REQUESTED refund (payments.refund); Σ refunds ≤ captured under FOR UPDATE', security: bearer, request: { body: json(createRefundBody) }, responses: { 201: ok(refund, 'RefundEnvelope', 'Created'), 422: err('REFUND_EXCEEDS_CAPTURED / PAYMENT_NOT_REFUNDABLE') } });
registry.registerPath({ method: 'get', path: '/refunds/{id}', tags: ['refunds'], summary: 'One refund (party → global)', security: bearer, request: { params: idParams }, responses: { 200: ok(refund, 'RefundEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'post', path: '/refunds/{id}/approve', tags: ['refunds'], summary: 'REQUESTED → APPROVED — four-eyes: not the requester', security: bearer, request: { params: idParams, body: json(refundDecisionBody) }, responses: { 200: ok(refund, 'RefundEnvelope'), 422: err('REFUND_FOUR_EYES / REFUND_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/refunds/{id}/reject', tags: ['refunds'], summary: '→ REJECTED with a reason', security: bearer, request: { params: idParams, body: json(rejectRefundBody) }, responses: { 200: ok(refund, 'RefundEnvelope'), 422: err('REFUND_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/refunds/{id}/process', tags: ['refunds'], summary: '202 — APPROVED → PROCESSING via PaymentGateway.refundPayment(); the terminal state arrives by the gateway’s refund webhook', security: bearer, request: { params: idParams }, responses: { 202: ok(refund, 'RefundEnvelope', 'Accepted'), 409: err('REFUND_ALREADY_PROCESSED'), 422: err('REFUND_INVALID_TRANSITION'), 502: err('PAYMENT_GATEWAY_ERROR') } });
