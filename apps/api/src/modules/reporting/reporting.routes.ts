import { Router } from 'express';
import type { z } from 'zod';
import { exportJobParams, listExportsQuery, reportCodeParams, reportExportBody } from '@unigate/validation';
import { paginated, sendAccepted, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as reports from './reporting.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;

/** api.md §8.28 `/reports`. Report-specific filters are validated by the registry, so the route accepts any query and lets the service decide. */
export function reportingRouter(): Router {
  const r = Router({ strict: true });
  r.use('/reports', authenticate(), csrfGuard());

  r.get('/reports', requirePermission('reports.read'), (_req, res) => {
    sendOk(res, reports.describe());
  });
  r.get('/reports/exports', requirePermission('reports.export'), validate({ query: listExportsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listExportsQuery>>).validated;
    const { items, total } = await reports.listExports(scopeFor(req, 'audit_logs.read', 'SELF'), query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.get('/reports/exports/:jobId', requirePermission('reports.export'), validate({ params: exportJobParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, z.infer<typeof exportJobParams>>).validated;
    sendOk(res, await reports.getExport(scopeFor(req, 'audit_logs.read', 'SELF'), params.jobId));
  }));
  r.get('/reports/exports/:jobId/download-url', requirePermission('reports.export'), validate({ params: exportJobParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, z.infer<typeof exportJobParams>>).validated;
    sendOk(res, await reports.downloadUrl(scopeFor(req, 'audit_logs.read', 'SELF'), params.jobId, { ipAddress: req.ip ?? null }));
  }));
  r.get('/reports/:code', requirePermission('reports.read'), validate({ params: reportCodeParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, z.infer<typeof reportCodeParams>>).validated;
    const { dto, page, pageSize, total } = await reports.run(scopeFor(req, 'bookings.read_any', 'OWN'), params.code, req.query);
    const envelope = paginated(dto.rows, page, pageSize, total);
    res.status(200).json({ ...envelope, meta: { ...envelope.meta, columns: dto.columns, code: dto.code } });
  }));
  r.post('/reports/:code/export', requirePermission('reports.export'), idempotent({ required: true }), validate({ params: reportCodeParams, body: reportExportBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof reportExportBody>, unknown, z.infer<typeof reportCodeParams>>).validated;
    sendAccepted(res, await reports.requestExport(scopeFor(req, 'bookings.read_any', 'OWN'), params.code, body));
  }));

  return r;
}
