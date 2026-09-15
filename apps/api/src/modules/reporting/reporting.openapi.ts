/** OpenAPI registrations for /reports (api.md §8.28) and /audit-logs (§8.30). */
import { z } from 'zod';
import { auditEntityParams, auditExportBody, exportJobParams, listAuditLogsQuery, listExportsQuery, offsetPagination, reportCodeParams, reportExportBody } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const bearer = [{ bearerAuth: [] }];
const ts = z.string().datetime();

const column = z.object({ key: z.string(), labelEn: z.string(), labelAr: z.string(), type: z.enum(['string', 'number', 'money', 'date', 'datetime', 'boolean']) });
const definition = z.object({ code: z.string(), nameEn: z.string(), nameAr: z.string(), descriptionEn: z.string(), financial: z.boolean(), scope: z.enum(['own-global', 'global']), filters: z.array(z.string()), columns: z.array(column), formats: z.array(z.string()), maxDays: z.number().int(), permission: z.string() }).openapi('ReportDefinition');
const row = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
const exportJob = z.object({ id: z.string().uuid(), reportCode: z.string(), format: z.string(), filters: z.record(z.string(), z.unknown()), status: z.string(), rowCount: z.number().int().nullable(), errorMessage: z.string().nullable(), expiresAt: ts.nullable(), downloadable: z.boolean(), createdAt: ts, updatedAt: ts }).openapi('ExportJob');
const download = z.object({ url: z.string().url(), expiresAt: ts, filename: z.string() }).openapi('ExportDownloadUrl');
const auditLog = z.object({ id: z.string().uuid(), occurredAt: ts, actorUserId: z.string().uuid().nullable(), actorName: z.string().nullable(), actorType: z.string(), actorRoles: z.array(z.string()), action: z.string(), entityType: z.string(), entityId: z.string(), severity: z.string(), beforeValue: z.record(z.string(), z.unknown()).nullable(), afterValue: z.record(z.string(), z.unknown()).nullable(), changedFields: z.array(z.string()), ipAddress: z.string().nullable(), userAgent: z.string().nullable(), requestId: z.string().uuid().nullable() }).openapi('AuditLog');

registry.registerPath({ method: 'get', path: '/reports', tags: ['reports'], summary: 'The report registry: codes, filters, columns, formats, max span and the permission each requires', security: bearer, responses: { 200: ok(z.array(definition), 'ReportDefinitionListEnvelope') } });
registry.registerPath({ method: 'get', path: '/reports/{code}', tags: ['reports'], summary: 'Run a report inline, paginated (max 200 rows); own → global; report-specific filters as query parameters; meta.columns describes the rows', security: bearer, request: { params: reportCodeParams, query: offsetPagination }, responses: { 200: ok(z.array(row), 'ReportRunEnvelope', 'OK — paginated'), 403: err('PERM_DENIED (staff-only or financial)'), 404: err('REPORT_NOT_FOUND'), 422: err('VALIDATION_FAILED (unsupported filter) / REPORT_RANGE_TOO_WIDE') } });
registry.registerPath({ method: 'post', path: '/reports/{code}/export', tags: ['reports'], summary: 'Queue an export (CSV today; Idempotency-Key required) — 202 with the job', security: bearer, request: { params: reportCodeParams, body: json(reportExportBody) }, responses: { 202: ok(exportJob, 'ExportJobEnvelope', 'Accepted'), 422: err('REPORT_FORMAT_NOT_AVAILABLE / REPORT_RANGE_TOO_WIDE') } });
registry.registerPath({ method: 'get', path: '/reports/exports', tags: ['reports'], summary: "The actor's export jobs (audit_logs.read holders see all)", security: bearer, request: { query: listExportsQuery }, responses: { 200: ok(z.array(exportJob), 'ExportJobListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'get', path: '/reports/exports/{jobId}', tags: ['reports'], summary: 'Job status: QUEUED, RUNNING, COMPLETED, FAILED, EXPIRED with rowCount and errorMessage', security: bearer, request: { params: exportJobParams }, responses: { 200: ok(exportJob, 'ExportJobEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'get', path: '/reports/exports/{jobId}/download-url', tags: ['reports'], summary: '120-second signed URL for the generated file; every issuance is audited', security: bearer, request: { params: exportJobParams }, responses: { 200: ok(download, 'ExportDownloadUrlEnvelope'), 422: err('EXPORT_NOT_READY / EXPORT_EXPIRED') } });

registry.registerPath({ method: 'get', path: '/audit-logs', tags: ['audit'], summary: 'Cursor-paginated audit trail (redaction-filtered at write time); reading it is itself audited', security: bearer, request: { query: listAuditLogsQuery }, responses: { 200: ok(z.array(auditLog), 'AuditLogListEnvelope') } });
registry.registerPath({ method: 'get', path: '/audit-logs/entities/{entityType}/{entityId}', tags: ['audit'], summary: 'Full change history of one record, oldest first', security: bearer, request: { params: auditEntityParams }, responses: { 200: ok(z.array(auditLog), 'AuditLogListEnvelope') } });
registry.registerPath({ method: 'post', path: '/audit-logs/export', tags: ['audit'], summary: 'Queue an audit export for a bounded window (max 90 days); Idempotency-Key required; the export is itself audited', security: bearer, request: { body: json(auditExportBody) }, responses: { 202: ok(exportJob, 'ExportJobEnvelope', 'Accepted'), 422: err('REPORT_RANGE_TOO_WIDE') } });
