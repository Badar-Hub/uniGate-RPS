import type { ActorScope, AnyScope, ExportDownloadUrlDto, ExportJobDto, ReportDefinitionDto, ReportRunDto } from '@unigate/types';
import type { z } from 'zod';
import { BusinessRuleError, ForbiddenError, NotFoundError } from '@/common/errors.js';
import { sha256Hex } from '@/common/crypto.js';
import { newId } from '@/common/ids.js';
import { config } from '@/config/index.js';
import { storageProvider } from '@/integrations/storage/storage.provider.js';
import { logger } from '@/logging/logger.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { toCsv } from './csv.js';
import { auditLogsReport, exportableByCode, REPORTS, type Cell, type ReportContext, type ReportDef } from './report.registry.js';
import * as repo from './reporting.repository.js';

/**
 * Reports (api.md §8.28). Inline runs are paginated (max 200 rows a page) and scoped; exports
 * are asynchronous by construction — a job row, a worker that pages the same `run()` into a
 * CSV in object storage, and a 120-second signed download URL whose issuance is audited.
 */

const INLINE_MAX = 200;
const EXPORT_PAGE = 1000;
const EXPORT_MAX_ROWS = 100_000;
const EXPORT_TTL_HOURS = 24;
const DOWNLOAD_URL_SECONDS = 120;
const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'reports', requestId: 'internal' };

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

function permissionFor(r: ReportDef): string {
  return r.financial && r.scope === 'global' ? 'reports.financial.read' : 'reports.read';
}

export function describe(): ReportDefinitionDto[] {
  return REPORTS.map((r) => ({ code: r.code, nameEn: r.nameEn, nameAr: r.nameAr, descriptionEn: r.descriptionEn, financial: r.financial, scope: r.scope, filters: Object.keys((r.filters as z.ZodObject<z.ZodRawShape>).shape), columns: r.columns, formats: ['CSV'], maxDays: r.maxDays, permission: permissionFor(r) }));
}

/** Scope + authority for one report: staff (bookings.read_any) run GLOBAL; everyone else OWN; financial GLOBAL needs reports.financial.read. */
function contextFor(scope: ActorScope, r: ReportDef, page: { page: number; pageSize: number }): ReportContext {
  const staff = scope.actor.permissions.has('bookings.read_any');
  if (r.scope === 'global' && !staff) throw new ForbiddenError('PERM_DENIED', 'This report is staff-only');
  if (r.financial && staff && !scope.actor.permissions.has('reports.financial.read')) throw new ForbiddenError('PERM_DENIED', 'Financial reports need reports.financial.read', { required: ['reports.financial.read'] });
  return { scope: { ...scope, kind: staff ? 'GLOBAL' : 'OWN' }, ownerProfileId: scope.actor.ownerProfileId, customerProfileId: scope.actor.customerProfileId, spoProfileId: scope.actor.spoProfileId, page: page.page, pageSize: page.pageSize };
}

function parseFilters(r: ReportDef, raw: Record<string, unknown>): Record<string, unknown> {
  const parsed = r.filters.safeParse(raw);
  if (!parsed.success) throw new BusinessRuleError('VALIDATION_FAILED', 'Unsupported or invalid report filters', { fieldErrors: parsed.error.flatten().fieldErrors, formErrors: parsed.error.flatten().formErrors });
  const f = parsed.data as { dateFrom?: string; dateTo?: string };
  if (f.dateFrom && f.dateTo) {
    const days = (new Date(f.dateTo).getTime() - new Date(f.dateFrom).getTime()) / 86_400_000;
    if (days < 0) throw new BusinessRuleError('VALIDATION_FAILED', 'dateTo precedes dateFrom', { fieldErrors: { dateTo: ['must not precede dateFrom'] }, formErrors: [] });
    if (days > r.maxDays) throw new BusinessRuleError('REPORT_RANGE_TOO_WIDE', `This report spans at most ${r.maxDays} days`, { maxDays: r.maxDays });
  }
  return parsed.data as Record<string, unknown>;
}

export async function run(scope: ActorScope, code: string, query: Record<string, unknown>): Promise<{ dto: ReportRunDto; page: number; pageSize: number; total: number }> {
  const r = REPORTS.find((x) => x.code === code);
  if (!r) throw new NotFoundError('REPORT_NOT_FOUND', 'Unknown report code');
  const { page: pg, pageSize: ps, ...rest } = query;
  const page = Math.max(1, Number(pg ?? 1));
  const pageSize = Math.min(INLINE_MAX, Math.max(1, Number(ps ?? 50)));
  const ctx = contextFor(scope, r, { page, pageSize });
  const filters = parseFilters(r, rest);
  const { rows, total } = await r.run(ctx, filters);
  return { dto: { code: r.code, columns: r.columns, rows }, page, pageSize, total };
}

// ── exports ──────────────────────────────────────────────────────────────────

function toJobDto(j: repo.ExportRow): ExportJobDto {
  const expired = j.expiresAt !== null && j.expiresAt < new Date();
  return { id: j.id, reportCode: j.reportCode, format: j.format, filters: typeof j.filters === 'object' && j.filters !== null && !Array.isArray(j.filters) ? j.filters : {}, status: expired && j.status === 'COMPLETED' ? 'EXPIRED' : j.status, rowCount: j.rowCount, errorMessage: j.errorMessage, expiresAt: j.expiresAt?.toISOString() ?? null, downloadable: j.status === 'COMPLETED' && !expired && j.documentId !== null, createdAt: j.createdAt.toISOString(), updatedAt: j.updatedAt.toISOString() };
}

export async function requestExport(scope: ActorScope, code: string, body: { format: 'CSV' | 'XLSX' | 'PDF'; filters: Record<string, unknown> }): Promise<ExportJobDto> {
  const r = exportableByCode(code);
  if (!r) throw new NotFoundError('REPORT_NOT_FOUND', 'Unknown report code');
  if (body.format !== 'CSV') throw new BusinessRuleError('REPORT_FORMAT_NOT_AVAILABLE', 'Only CSV exports are generated today; XLSX and PDF rendering are not yet available', { available: ['CSV'] });
  if (r.code === auditLogsReport.code) {
    if (!scope.actor.permissions.has('audit_logs.read')) throw new ForbiddenError('PERM_DENIED', 'Audit exports need audit_logs.read', { required: ['audit_logs.read'] });
  } else contextFor(scope, r, { page: 1, pageSize: 1 });
  const filters = parseFilters(r, body.filters);
  const job = await repo.insertJob(scope, { id: newId(), requestedByUserId: scope.actor.userId, reportCode: r.code, format: body.format, filters: filters as never, status: 'QUEUED' });
  await writeAudit({ ...audit(scope), action: 'report.export_requested', entityType: 'export_job', entityId: job.id, severity: r.code === auditLogsReport.code ? 'NOTICE' : 'INFO', afterValue: { reportCode: r.code, format: body.format, filters } });
  return toJobDto(job);
}

export async function listExports(scope: ActorScope, q: { status?: string | undefined; reportCode?: string | undefined; page: number; pageSize: number }): Promise<{ items: ExportJobDto[]; total: number }> {
  const { items, total } = await repo.listJobs(scope, q, q);
  return { items: items.map(toJobDto), total };
}

export async function getExport(scope: ActorScope, id: string): Promise<ExportJobDto> {
  const j = await repo.findJob(scope, id);
  if (!j) throw new NotFoundError();
  return toJobDto(j);
}

export async function downloadUrl(scope: ActorScope, id: string, meta: { ipAddress: string | null }): Promise<ExportDownloadUrlDto> {
  const j = await repo.findJob(scope, id);
  if (!j) throw new NotFoundError();
  if (j.status !== 'COMPLETED' || !j.documentId) throw new BusinessRuleError('EXPORT_NOT_READY', `The export is ${j.status}`, { status: j.status });
  if (j.expiresAt && j.expiresAt < new Date()) throw new BusinessRuleError('EXPORT_EXPIRED', 'The export file has expired; request it again');
  const doc = await repo.findExportDocument(scope, j.documentId);
  if (!doc) throw new NotFoundError();
  const url = await storageProvider().getDownloadUrl({ bucket: doc.storageBucket, key: doc.storageKey, filename: doc.originalFilename, contentType: doc.mimeType, ttlSeconds: DOWNLOAD_URL_SECONDS });
  await writeAudit({ ...audit(scope), action: 'report.export_downloaded', entityType: 'export_job', entityId: j.id, severity: j.reportCode === auditLogsReport.code ? 'NOTICE' : 'INFO', afterValue: { reportCode: j.reportCode, expiresAt: url.expiresAt.toISOString() }, ipAddress: meta.ipAddress });
  return { url: url.url, expiresAt: url.expiresAt.toISOString(), filename: doc.originalFilename };
}

// ── worker ───────────────────────────────────────────────────────────────────

/** Runs one queued export to completion. Returns false when the queue is empty. */
export async function processNextExport(): Promise<boolean> {
  const job = await repo.claimNextQueued(systemScope);
  if (!job) return false;
  const r = exportableByCode(job.reportCode);
  try {
    if (!r) throw new Error(`unknown report ${job.reportCode}`);
    const requester = await requesterContext(job.requestedByUserId);
    const filters = r.filters.parse(job.filters) as Record<string, unknown>;
    const rows: Record<string, Cell>[] = [];
    for (let page = 1; rows.length < EXPORT_MAX_ROWS; page++) {
      const { rows: chunk, total } = await r.run({ ...requester, page, pageSize: EXPORT_PAGE }, filters);
      rows.push(...chunk);
      if (chunk.length < EXPORT_PAGE || rows.length >= total) break;
    }
    const csv = Buffer.from(toCsv(r.columns, rows.slice(0, EXPORT_MAX_ROWS)), 'utf8');
    const filename = `${r.code}-${job.createdAt.toISOString().slice(0, 10)}-${job.id.slice(0, 8)}.csv`;
    const key = `exports/${job.requestedByUserId}/${job.id}.csv`;
    const bucket = config().storage.bucket;
    await storageProvider().put(bucket, key, csv, 'text/csv');
    const documentId = newId();
    await repo.insertExportDocument(systemScope, { id: documentId, documentTypeCode: 'REPORT_EXPORT', userId: job.requestedByUserId, storageBucket: bucket, storageKey: key, originalFilename: filename, mimeType: 'text/csv', sizeBytes: BigInt(csv.length), checksumSha256: sha256Hex(csv), uploadStatus: 'UPLOADED', verificationStatus: 'VERIFIED', verifiedAt: new Date(), visibility: 'PRIVATE' });
    await repo.updateJob(systemScope, job.id, { status: 'COMPLETED', rowCount: Math.min(rows.length, EXPORT_MAX_ROWS), documentId, expiresAt: new Date(Date.now() + EXPORT_TTL_HOURS * 3_600_000), errorMessage: null });
  } catch (err) {
    logger().error({ err, jobId: job.id, reportCode: job.reportCode }, 'export failed');
    await repo.updateJob(systemScope, job.id, { status: 'FAILED', errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 500) });
  }
  return true;
}

/** The requester's scope at run time — an owner's export never widens past their own rows even if it runs in the worker. */
async function requesterContext(userId: string): Promise<Omit<ReportContext, 'page' | 'pageSize'>> {
  const { resolveAuthority } = await import('@/modules/iam/permission.service.js');
  const { prisma } = await import('@/database/prisma.js');
  const authority = await resolveAuthority(userId);
  const u = await prisma().user.findUniqueOrThrow({ where: { id: userId }, select: { ownerProfile: { select: { id: true } }, customerProfile: { select: { id: true } }, spoProfile: { select: { id: true } } } });
  const staff = authority.permissions.has('bookings.read_any');
  return {
    scope: { kind: staff ? 'GLOBAL' : 'OWN', requestId: 'export', actor: { userId, sessionId: null, roles: authority.roles, permissions: authority.permissions, customerProfileId: u.customerProfile?.id ?? null, ownerProfileId: u.ownerProfile?.id ?? null, driverProfileId: null, spoProfileId: u.spoProfile?.id ?? null, locale: 'en' } },
    ownerProfileId: u.ownerProfile?.id ?? null, customerProfileId: u.customerProfile?.id ?? null, spoProfileId: u.spoProfile?.id ?? null,
  };
}

export async function expireExports(): Promise<number> {
  return repo.expireJobs(systemScope, new Date());
}
