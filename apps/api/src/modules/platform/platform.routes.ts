import { Router } from 'express';
import type { z } from 'zod';
import { auditEntityParams, auditExportBody, listAuditLogsQuery } from '@unigate/validation';
import { ok, sendAccepted, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as audit from './audit-log.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;

/** api.md §8.30 `/audit-logs`. */
export function platformRouter(): Router {
  const r = Router({ strict: true });
  r.use('/audit-logs', authenticate(), csrfGuard());

  r.get('/audit-logs', requirePermission('audit_logs.read'), validate({ query: listAuditLogsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listAuditLogsQuery>>).validated;
    const { items, nextCursor } = await audit.list(scopeFor(req, 'audit_logs.read'), query);
    res.status(200).json(ok(items, { nextCursor }));
  }));
  r.get('/audit-logs/entities/:entityType/:entityId', requirePermission('audit_logs.read'), validate({ params: auditEntityParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, z.infer<typeof auditEntityParams>>).validated;
    sendOk(res, await audit.entityHistory(scopeFor(req, 'audit_logs.read'), params.entityType, params.entityId));
  }));
  r.post('/audit-logs/export', requirePermission('audit_logs.read', 'reports.export'), idempotent({ required: true }), validate({ body: auditExportBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof auditExportBody>>).validated;
    sendAccepted(res, await audit.exportLogs(scopeFor(req, 'audit_logs.read'), body));
  }));

  return r;
}
