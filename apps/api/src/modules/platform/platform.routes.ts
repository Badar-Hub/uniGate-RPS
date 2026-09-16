import express, { Router } from 'express';
import type { z } from 'zod';
import { auditEntityParams, auditExportBody, listAuditLogsQuery } from '@unigate/validation';
import { ok, sendAccepted, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { routeTier } from '@/middleware/rate-limit.js';
import { logger } from '@/logging/logger.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as audit from './audit-log.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;

/** Shape of a browser CSP violation report (report-uri: `{ 'csp-report': {...} }`; Reporting API: `[{ body: {...} }]`). */
interface CspViolation {
  'document-uri'?: string;
  documentURL?: string;
  'violated-directive'?: string;
  'effective-directive'?: string;
  effectiveDirective?: string;
  'blocked-uri'?: string;
  blockedURL?: string;
  disposition?: string;
}

function violations(body: unknown): CspViolation[] {
  if (Array.isArray(body)) return body.map((r) => (r as { body?: CspViolation }).body ?? {});
  const single = (body as { 'csp-report'?: CspViolation } | null)?.['csp-report'];
  return single ? [single] : [];
}

function host(uri: string | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).host;
  } catch {
    return uri.slice(0, 40); // 'inline', 'eval', 'data' …
  }
}

/** api.md §8.30 `/audit-logs`; security.md §6.3 `/platform/csp-report`. */
export function platformRouter(): Router {
  const r = Router({ strict: true });

  // Browsers post violation reports without credentials: public, IP-throttled, size-capped, never echoed.
  // Only the directive and the offending host are logged — the document URL could carry a query string.
  r.post(
    '/platform/csp-report',
    routeTier('csp-report', { limit: 30, seconds: 60 }),
    express.json({ type: ['application/csp-report', 'application/reports+json', 'application/json'], limit: '16kb' }),
    (req, res) => {
      for (const v of violations(req.body).slice(0, 10)) {
        const doc = v['document-uri'] ?? v.documentURL;
        logger().warn(
          { directive: v['effective-directive'] ?? v.effectiveDirective ?? v['violated-directive'] ?? null, blocked: host(v['blocked-uri'] ?? v.blockedURL), page: doc ? new URL(doc, 'http://x').pathname : null, disposition: v.disposition ?? null },
          'csp violation reported',
        );
      }
      res.status(204).end();
    },
  );

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
  r.post('/audit-logs/export', requirePermission('audit_logs.read', 'reports.export'), routeTier('report-export', { limit: 5, seconds: 3600 }), idempotent({ required: true }), validate({ body: auditExportBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof auditExportBody>>).validated;
    sendAccepted(res, await audit.exportLogs(scopeFor(req, 'audit_logs.read'), body));
  }));

  return r;
}
