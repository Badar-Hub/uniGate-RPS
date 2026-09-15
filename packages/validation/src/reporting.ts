import { z } from 'zod';
import { AUDIT_SEVERITY } from '@unigate/types';
import { isoDate, isoTimestamp, uuid } from './primitives.js';
import { cursorPagination, offsetPagination } from './pagination.js';

/** Reports (api.md §8.28) and audit logs (§8.30). Report-specific filters are validated by the registry. */

export const reportCodeParams = z.object({ code: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/) }).strict();
export const reportRunQuery = offsetPagination.extend({}).passthrough();
export const reportExportBody = z.object({ format: z.enum(['CSV', 'XLSX', 'PDF']).default('CSV'), filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}) }).strict();
export const listExportsQuery = offsetPagination.extend({ status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED']).optional(), reportCode: z.string().max(64).optional() }).strict();
export const exportJobParams = z.object({ jobId: uuid }).strict();

export const listAuditLogsQuery = cursorPagination
  .extend({ actorUserId: uuid.optional(), action: z.string().max(96).optional(), entityType: z.string().max(64).optional(), entityId: z.string().max(128).optional(), severity: z.enum(AUDIT_SEVERITY).optional(), requestId: uuid.optional(), ipAddress: z.string().max(45).optional(), dateFrom: isoTimestamp.optional(), dateTo: isoTimestamp.optional() })
  .strict();
export const auditEntityParams = z.object({ entityType: z.string().regex(/^[a-z_]{2,64}$/), entityId: z.string().min(1).max(128) }).strict();
export const auditExportBody = z.object({ dateFrom: isoDate, dateTo: isoDate, actorUserId: uuid.optional(), action: z.string().max(96).optional(), entityType: z.string().max(64).optional(), severity: z.enum(AUDIT_SEVERITY).optional() }).strict().refine((b) => b.dateTo >= b.dateFrom, 'dateTo must not precede dateFrom');
