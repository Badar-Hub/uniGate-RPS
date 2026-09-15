import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import {
  addSettlementLineBody, approveSettlementBody, clearanceQueueQuery, commissionEarningsQuery, commissionPreviewBody, createCommissionRuleBody, createExpenseBody, createInvoiceBody, createSettlementBody, creditNoteBody, debitNoteBody, expenseSummaryQuery, generateInvoicesBody, idParams,
  listCommissionRulesQuery, listExpensesQuery, listInvoiceLinesQuery, listInvoicesQuery, listLedgerEntriesQuery, listSettlementsQuery, ownerIdParams, patchCommissionRuleBody, patchExpenseBody, paySettlementBody, rejectSettlementBody, settlementPreviewQuery, voidInvoiceBody,
} from '@unigate/validation';
import { ok, paginated, sendNoContent, sendOk } from '@/common/envelope.js';
import { ForbiddenError } from '@/common/errors.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as commissions from './commission-admin.service.js';
import * as expenses from './expense.service.js';
import * as invoices from './invoice.service.js';
import { listLedgerGroups } from './ledger.service.js';
import * as settlements from './settlement.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/**
 * api.md §8.19 `/invoices`, §8.20 `/commissions`, §8.21 `/settlements` + `/ledger`, §8.22
 * `/expenses`. Every finance code is global except the owner-facing reads (settlements, earnings,
 * expenses — OWN) and the buyer-facing invoice reads (OWN); staff open GLOBAL through the issuing /
 * managing code of each surface.
 */
export function financeRouter(): Router {
  const r = Router({ strict: true });
  r.use(['/commissions', '/settlements', '/ledger', '/invoices', '/admin/invoices', '/expenses'], authenticate(), csrfGuard());
  const page = (res: Response, items: unknown[], q: { page: number; pageSize: number }, total: number) => res.status(200).json(paginated(items, q.page, q.pageSize, total));

  // ── commissions ───────────────────────────────────────────────────────────
  r.get('/commissions/rules', requirePermission('commissions.read'), validate({ query: listCommissionRulesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listCommissionRulesQuery>>).validated;
    const { items, total } = await commissions.listRules(scopeFor(req, 'commissions.read'), query, query);
    page(res, items, query, total);
  }));
  r.post('/commissions/rules', requirePermission('commissions.manage'), validate({ body: createCommissionRuleBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createCommissionRuleBody>>).validated;
    const dto = await commissions.createRule(scopeFor(req, 'commissions.manage'), body);
    res.status(201).json(ok(dto));
  }));
  r.post('/commissions/rules/preview', requirePermission('commissions.read'), validate({ body: commissionPreviewBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof commissionPreviewBody>>).validated;
    sendOk(res, await commissions.previewCommission(scopeFor(req, 'commissions.read'), body));
  }));
  r.get('/commissions/earnings', requirePermission('commissions.read'), validate({ query: commissionEarningsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof commissionEarningsQuery>>).validated;
    // Cross-tenant totals need the reporting code as well (api.md §8.20); owners are pinned to their own rows by the scope.
    const scope = scopeFor(req, 'reports.financial.read', 'OWN');
    if (scope.kind !== 'GLOBAL' && !scope.actor.ownerProfileId) throw new ForbiddenError('FORBIDDEN', 'Earnings across owners need reports.financial.read');
    sendOk(res, await commissions.earnings(scope, query));
  }));
  r.get('/commissions/rules/:id', requirePermission('commissions.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await commissions.getRule(scopeFor(req, 'commissions.read'), params.id));
  }));
  r.patch('/commissions/rules/:id', requirePermission('commissions.manage'), validate({ params: idParams, body: patchCommissionRuleBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchCommissionRuleBody>, unknown, Id>).validated;
    sendOk(res, await commissions.patchRule(scopeFor(req, 'commissions.manage'), params.id, body));
  }));
  r.delete('/commissions/rules/:id', requirePermission('commissions.manage'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    await commissions.deactivateRule(scopeFor(req, 'commissions.manage'), params.id);
    sendNoContent(res);
  }));

  // ── settlements ───────────────────────────────────────────────────────────
  const settlementScope = (req: Request) => scopeFor(req, 'settlements.create', 'OWN');
  r.get('/settlements', requirePermission('settlements.read'), validate({ query: listSettlementsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listSettlementsQuery>>).validated;
    const { items, total } = await settlements.listSettlements(settlementScope(req), query, query);
    page(res, items, query, total);
  }));
  r.get('/settlements/preview', requirePermission('settlements.read'), validate({ query: settlementPreviewQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof settlementPreviewQuery>>).validated;
    sendOk(res, await settlements.preview(settlementScope(req), query));
  }));
  r.post('/settlements', requirePermission('settlements.create'), idempotent({ required: true }), validate({ body: createSettlementBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createSettlementBody>>).validated;
    const dto = await settlements.createSettlement(scopeFor(req, 'settlements.create'), body);
    res.setHeader('Location', `/api/v1/settlements/${dto.id}`);
    res.status(201).json(ok(dto));
  }));
  r.get('/settlements/:id', requirePermission('settlements.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await settlements.getSettlement(settlementScope(req), params.id));
  }));
  r.get('/settlements/:id/lines', requirePermission('settlements.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await settlements.listLines(settlementScope(req), params.id));
  }));
  r.post('/settlements/:id/lines', requirePermission('settlements.create'), idempotent({ required: false }), validate({ params: idParams, body: addSettlementLineBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof addSettlementLineBody>, unknown, Id>).validated;
    res.status(201).json(ok(await settlements.addLine(scopeFor(req, 'settlements.create'), params.id, body)));
  }));
  r.post('/settlements/:id/submit', requirePermission('settlements.create'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await settlements.submit(scopeFor(req, 'settlements.create'), params.id));
  }));
  r.post('/settlements/:id/approve', requirePermission('settlements.approve'), validate({ params: idParams, body: approveSettlementBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof approveSettlementBody>, unknown, Id>).validated;
    sendOk(res, await settlements.approve(scopeFor(req, 'settlements.approve'), params.id, body.notes));
  }));
  r.post('/settlements/:id/reject', requirePermission('settlements.approve'), validate({ params: idParams, body: rejectSettlementBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof rejectSettlementBody>, unknown, Id>).validated;
    sendOk(res, await settlements.reject(scopeFor(req, 'settlements.approve'), params.id, body.reason));
  }));
  r.post('/settlements/:id/pay', requirePermission('settlements.pay'), idempotent({ required: true }), validate({ params: idParams, body: paySettlementBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof paySettlementBody>, unknown, Id>).validated;
    res.status(202).json(ok(await settlements.pay(scopeFor(req, 'settlements.pay'), params.id, body)));
  }));

  // ── ledger ────────────────────────────────────────────────────────────────
  r.get('/ledger/entries', requirePermission('ledger.read'), validate({ query: listLedgerEntriesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listLedgerEntriesQuery>>).validated;
    const { items, total } = await listLedgerGroups(scopeFor(req, 'ledger.read'), query, query);
    page(res, items, query, total);
  }));
  r.get('/ledger/balances/owners/:ownerProfileId', requirePermission('ledger.read'), validate({ params: ownerIdParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, z.infer<typeof ownerIdParams>>).validated;
    sendOk(res, await settlements.ownerBalance(scopeFor(req, 'ledger.read'), params.ownerProfileId));
  }));

  // ── invoices ──────────────────────────────────────────────────────────────
  const invoiceScope = (req: Request) => scopeFor(req, 'invoices.issue', 'OWN');
  r.get('/invoices', requirePermission('invoices.read'), validate({ query: listInvoicesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listInvoicesQuery>>).validated;
    const { items, total } = await invoices.listInvoices(invoiceScope(req), query, query);
    page(res, items, query, total);
  }));
  r.post('/invoices', requirePermission('invoices.issue'), idempotent({ required: true }), validate({ body: createInvoiceBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createInvoiceBody>>).validated;
    const dto = await invoices.issueForBooking(scopeFor(req, 'invoices.issue'), body.bookingId);
    res.setHeader('Location', `/api/v1/invoices/${dto.id}`);
    res.status(201).json(ok(dto));
  }));
  r.post('/admin/invoices/generate', requirePermission('invoices.issue'), idempotent({ required: true }), validate({ body: generateInvoicesBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof generateInvoicesBody>>).validated;
    res.status(202).json(ok(await invoices.generateCycle(scopeFor(req, 'invoices.issue'), body)));
  }));
  r.get('/admin/invoices/clearance-queue', requirePermission('invoices.issue'), validate({ query: clearanceQueueQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof clearanceQueueQuery>>).validated;
    const { items, total } = await invoices.clearanceQueue(scopeFor(req, 'invoices.issue'), query, query);
    page(res, items, query, total);
  }));
  r.post('/admin/invoices/:id/retry-clearance', requirePermission('invoices.issue'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    res.status(202).json(ok(await invoices.retryClearance(scopeFor(req, 'invoices.issue'), params.id)));
  }));
  r.get('/invoices/:id', requirePermission('invoices.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await invoices.getInvoice(invoiceScope(req), params.id));
  }));
  r.get('/invoices/:id/lines', requirePermission('invoices.read'), validate({ params: idParams, query: listInvoiceLinesQuery }), h(async (req, res) => {
    const { params, query } = (req as R<unknown, z.infer<typeof listInvoiceLinesQuery>, Id>).validated;
    const { items, total } = await invoices.listLines(invoiceScope(req), params.id, query);
    page(res, items, query, total);
  }));
  r.get('/invoices/:id/pdf-url', requirePermission('invoices.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await invoices.pdfUrl(invoiceScope(req), params.id));
  }));
  r.get('/invoices/:id/xml', requirePermission('invoices.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await invoices.xmlUrl(invoiceScope(req), params.id));
  }));
  r.post('/invoices/:id/void', requirePermission('invoices.issue'), idempotent({ required: false }), validate({ params: idParams, body: voidInvoiceBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof voidInvoiceBody>, unknown, Id>).validated;
    sendOk(res, await invoices.voidInvoice(scopeFor(req, 'invoices.issue'), params.id, body.reason));
  }));
  r.post('/invoices/:id/credit-note', requirePermission('invoices.issue'), idempotent({ required: true }), validate({ params: idParams, body: creditNoteBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof creditNoteBody>, unknown, Id>).validated;
    res.status(201).json(ok(await invoices.creditNote(scopeFor(req, 'invoices.issue'), params.id, body)));
  }));
  r.post('/invoices/:id/debit-note', requirePermission('invoices.issue'), idempotent({ required: true }), validate({ params: idParams, body: debitNoteBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof debitNoteBody>, unknown, Id>).validated;
    res.status(201).json(ok(await invoices.debitNote(scopeFor(req, 'invoices.issue'), params.id, body)));
  }));

  // ── expenses ──────────────────────────────────────────────────────────────
  const expenseScope = (req: Request) => scopeFor(req, 'expenses.read_any', 'OWN');
  r.get('/expenses', requirePermission('expenses.read'), validate({ query: listExpensesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listExpensesQuery>>).validated;
    const { items, total } = await expenses.listExpenses(expenseScope(req), query, query);
    page(res, items, query, total);
  }));
  r.get('/expenses/summary', requirePermission('expenses.read'), validate({ query: expenseSummaryQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof expenseSummaryQuery>>).validated;
    sendOk(res, await expenses.summary(expenseScope(req), query));
  }));
  r.post('/expenses', requirePermission('expenses.create'), idempotent({ required: false }), validate({ body: createExpenseBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createExpenseBody>>).validated;
    const dto = await expenses.createExpense(expenseScope(req), body);
    res.setHeader('Location', `/api/v1/expenses/${dto.id}`);
    res.status(201).json(ok(dto));
  }));
  r.get('/expenses/:id', requirePermission('expenses.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await expenses.getExpense(expenseScope(req), params.id));
  }));
  r.patch('/expenses/:id', requirePermission('expenses.update'), validate({ params: idParams, body: patchExpenseBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchExpenseBody>, unknown, Id>).validated;
    sendOk(res, await expenses.patchExpense(expenseScope(req), params.id, body));
  }));
  r.delete('/expenses/:id', requirePermission('expenses.delete'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    await expenses.deleteExpense(expenseScope(req), params.id);
    sendNoContent(res);
  }));

  return r;
}
