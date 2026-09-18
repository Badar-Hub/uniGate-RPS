import express, { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { cancelPaymentBody, createPaymentBody, createRefundBody, idParams, listPaymentsQuery, listRefundsQuery, mockCheckoutBody, providerParams, refundDecisionBody, rejectRefundBody, rejectTransferBody, submitTransferReceiptBody, verifyTransferBody } from '@unigate/validation';
import { ok, paginated, sendOk } from '@/common/envelope.js';
import { NotFoundError } from '@/common/errors.js';
import { h } from '@/common/handler.js';
import { config } from '@/config/index.js';
import { mockGateway } from '@/integrations/payments/index.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { providerTier, routeTier } from '@/middleware/rate-limit.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import { HEADER_IDEMPOTENCY_KEY } from '@unigate/types';
import * as bankTransfer from './bank-transfer.service.js';
import * as payments from './payment.service.js';
import * as refunds from './refund.service.js';
import { ingestWebhook, processWebhookEvent } from './webhook.service.js';
import { enqueueWebhookProcessing } from './payments.jobs.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/**
 * api.md §8.17 `/payments`, §8.18 `/refunds`, §10 `/webhooks/payments/:provider`. The webhook route
 * carries no session and is authenticated by signature over the RAW body; everything else sits
 * behind the normal guards.
 */
export function paymentsRouter(): Router {
  const r = Router({ strict: true });

  // ── webhooks: raw body, no session, persist-then-process ──────────────────
  r.post('/webhooks/payments/:provider', providerTier('webhook-ingest', { limit: 1000, seconds: 60 }), express.raw({ type: '*/*', limit: '256kb' }), validate({ params: providerParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, z.infer<typeof providerParams>>).validated;
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v.join(',') : v]));
    const { receipt, eventRowId } = await ingestWebhook(params.provider, raw, headers);
    // Answer first; the job does the work (target < 200 ms).
    res.status(200).json(ok(receipt));
    if (eventRowId) enqueueWebhookProcessing(eventRowId);
  }));

  // Development only: the MockGateway's "hosted page" drives the outcome. A real provider's page needs
  // no session with us, and neither does this one — the phone's in-app browser has no portal cookies.
  // Refused outright without the mock gateway or in production; the provider payment id is the only handle.
  r.post('/payments/mock/checkout/:providerPaymentId', routeTier('mock-checkout', { limit: 30, seconds: 60 }), validate({ body: mockCheckoutBody }), h(async (req, res) => {
    const g = mockGateway();
    if (!g || config().isProduction) throw new NotFoundError('ROUTE_NOT_FOUND', 'The mock checkout exists only with the mock gateway outside production');
    const { body } = (req as R<z.infer<typeof mockCheckoutBody>>).validated;
    const providerPaymentId = String(req.params['providerPaymentId'] ?? '');
    const deliveries = g.simulateCheckout(providerPaymentId, body.outcome, body.last4);
    const receipts = [];
    if (body.deliverWebhook) {
      // The gateway "calls" our own webhook route: signature, persist-first and the job all run for real.
      for (const d of deliveries) {
        const { receipt, eventRowId } = await ingestWebhook(g.code, d.body, d.headers);
        if (eventRowId) await processWebhookEvent(eventRowId);
        receipts.push(receipt);
      }
    }
    sendOk(res, { outcome: body.outcome, delivered: receipts });
  }));

  r.use(['/payments', '/refunds', '/admin/payments'], authenticate(), csrfGuard());
  const readScope = (req: Request) => scopeFor(req, 'payments.read_any', 'PARTY');

  // ── payments ──────────────────────────────────────────────────────────────
  r.get('/payments/config', requirePermission('payments.read'), h(async (_req, res) => {
    sendOk(res, await payments.paymentConfig());
  }));
  r.get('/payments', requirePermission('payments.read'), validate({ query: listPaymentsQuery }), h(async (req, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof listPaymentsQuery>>).validated;
    const { items, total } = await payments.listPayments(scopeFor(req, 'payments.read_any', 'OWN'), query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/payments', requirePermission('payments.create'), idempotent({ required: true }), validate({ body: createPaymentBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createPaymentBody>>).validated;
    const key = req.header(HEADER_IDEMPOTENCY_KEY) ?? null;
    const result = await payments.createPayment(scopeFor(req, 'payments.manage', 'OWN'), body, key);
    res.setHeader('Location', `/api/v1/payments/${result.payment.id}`);
    res.status(201).json(ok(result));
  }));
  // Bank transfer (IBFT): the payer attaches the receipt; finance verifies or rejects against the bank statement.
  r.post('/payments/:id/receipt', requirePermission('payments.create'), validate({ params: idParams, body: submitTransferReceiptBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof submitTransferReceiptBody>, unknown, Id>).validated;
    sendOk(res, await bankTransfer.submitReceipt(scopeFor(req, 'payments.manage', 'OWN'), params.id, body));
  }));
  r.post('/admin/payments/:id/verify-transfer', requirePermission('payments.manage'), validate({ params: idParams, body: verifyTransferBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof verifyTransferBody>, unknown, Id>).validated;
    sendOk(res, await bankTransfer.verifyTransfer(scopeFor(req, 'payments.manage'), params.id, body));
  }));
  r.post('/admin/payments/:id/reject-transfer', requirePermission('payments.manage'), validate({ params: idParams, body: rejectTransferBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof rejectTransferBody>, unknown, Id>).validated;
    sendOk(res, await bankTransfer.rejectTransfer(scopeFor(req, 'payments.manage'), params.id, body));
  }));
  r.get('/payments/:id', requirePermission('payments.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await payments.getPayment(readScope(req), params.id));
  }));
  r.get('/payments/:id/status', requirePermission('payments.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await payments.paymentStatus(readScope(req), params.id));
  }));
  r.get('/payments/:id/transactions', requirePermission('payments.read_any'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await payments.listTransactions(scopeFor(req, 'payments.read_any'), params.id));
  }));
  r.post('/payments/:id/sync', requirePermission('payments.manage'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await payments.syncPayment(scopeFor(req, 'payments.manage'), params.id));
  }));
  r.post('/payments/:id/cancel', requirePermission('payments.create'), validate({ params: idParams, body: cancelPaymentBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof cancelPaymentBody>, unknown, Id>).validated;
    sendOk(res, await payments.cancelPayment(scopeFor(req, 'payments.manage', 'OWN'), params.id, body.reason));
  }));


  // ── refunds ───────────────────────────────────────────────────────────────
  r.get('/refunds', requirePermission('payments.read'), validate({ query: listRefundsQuery }), h(async (req, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof listRefundsQuery>>).validated;
    const { items, total } = await refunds.listRefunds(scopeFor(req, 'payments.read_any', 'OWN'), query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/refunds', requirePermission('payments.refund'), idempotent({ required: false }), validate({ body: createRefundBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createRefundBody>>).validated;
    const dto = await refunds.createRefund(scopeFor(req, 'payments.refund'), body);
    res.status(201).json(ok(dto));
  }));
  r.get('/refunds/:id', requirePermission('payments.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await refunds.getRefund(readScope(req), params.id));
  }));
  r.post('/refunds/:id/approve', requirePermission('payments.refund'), validate({ params: idParams, body: refundDecisionBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof refundDecisionBody>, unknown, Id>).validated;
    sendOk(res, await refunds.approveRefund(scopeFor(req, 'payments.refund'), params.id, body.notes));
  }));
  r.post('/refunds/:id/reject', requirePermission('payments.refund'), validate({ params: idParams, body: rejectRefundBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof rejectRefundBody>, unknown, Id>).validated;
    sendOk(res, await refunds.rejectRefund(scopeFor(req, 'payments.refund'), params.id, body.reason));
  }));
  r.post('/refunds/:id/process', requirePermission('payments.refund'), idempotent({ required: false }), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    const dto = await refunds.processRefund(scopeFor(req, 'payments.refund'), params.id);
    res.status(202).json(ok(dto));
  }));

  return r;
}
