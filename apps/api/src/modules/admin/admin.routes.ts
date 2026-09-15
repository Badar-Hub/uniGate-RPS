import { Router } from 'express';
import type { z } from 'zod';
import { adminDashboardQuery, adminDashboardSeriesQuery, idParams, listOutboxQuery, listWebhookEventsQuery } from '@unigate/validation';
import { paginated, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as a from './admin.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/** api.md §8.29 `/admin/*` — dashboard, system health and queues, payment webhook tooling, outbox retry. */
export function adminRouter(): Router {
  const r = Router({ strict: true });
  r.use(['/admin/dashboard', '/admin/system', '/admin/webhooks', '/admin/outbox'], authenticate(), csrfGuard());

  r.get('/admin/dashboard', requirePermission('dashboard.read'), validate({ query: adminDashboardQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof adminDashboardQuery>>).validated;
    const dto = await a.dashboard(scopeFor(req, 'dashboard.read'), query);
    sendOk(res, dto, { computedAt: dto.computedAt });
  }));
  r.get('/admin/dashboard/series', requirePermission('dashboard.read'), validate({ query: adminDashboardSeriesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof adminDashboardSeriesQuery>>).validated;
    sendOk(res, await a.dashboardSeries(scopeFor(req, 'dashboard.read'), query));
  }));
  r.get('/admin/system/health', requirePermission('system.health.read'), h(async (req, res) => {
    sendOk(res, await a.health(scopeFor(req, 'system.health.read')));
  }));
  r.get('/admin/system/queues', requirePermission('platform.jobs.manage'), h(async (req, res) => {
    sendOk(res, await a.queues(scopeFor(req, 'platform.jobs.manage')));
  }));
  r.get('/admin/webhooks/payments', requirePermission('payments.manage'), validate({ query: listWebhookEventsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listWebhookEventsQuery>>).validated;
    const { items, total } = await a.listWebhookEvents(scopeFor(req, 'payments.manage'), query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/admin/webhooks/payments/:id/replay', requirePermission('payments.manage'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await a.replayWebhook(scopeFor(req, 'payments.manage'), params.id));
  }));
  r.get('/admin/outbox', requirePermission('platform.jobs.manage'), validate({ query: listOutboxQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listOutboxQuery>>).validated;
    const { items, total } = await a.listOutbox(scopeFor(req, 'platform.jobs.manage'), query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/admin/outbox/:id/retry', requirePermission('platform.jobs.manage'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await a.retryOutbox(scopeFor(req, 'platform.jobs.manage'), params.id));
  }));

  return r;
}
