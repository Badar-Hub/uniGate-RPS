import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/** Export jobs (api.md §8.28): SELF for the requester, GLOBAL for reports.export holders with a global scope. */

export const exportSelect = { id: true, requestedByUserId: true, reportCode: true, format: true, filters: true, status: true, rowCount: true, documentId: true, errorMessage: true, expiresAt: true, createdAt: true, updatedAt: true } satisfies Prisma.ExportJobSelect;
export type ExportRow = Prisma.ExportJobGetPayload<{ select: typeof exportSelect }>;

function scopeWhere(scope: AnyScope): Prisma.ExportJobWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  return { requestedByUserId: scope.actor.userId };
}

export async function insertJob(_scope: AnyScope, data: Prisma.ExportJobUncheckedCreateInput): Promise<ExportRow> {
  return prisma().exportJob.create({ data, select: exportSelect });
}

export async function findJob(scope: AnyScope, id: string): Promise<ExportRow | null> {
  return prisma().exportJob.findFirst({ where: { AND: [{ id }, scopeWhere(scope)] }, select: exportSelect });
}

export async function listJobs(scope: AnyScope, f: { status?: string | undefined; reportCode?: string | undefined }, page: { page: number; pageSize: number }): Promise<{ items: ExportRow[]; total: number }> {
  const where: Prisma.ExportJobWhereInput = { AND: [scopeWhere(scope), ...(f.status ? [{ status: f.status as ExportRow['status'] }] : []), ...(f.reportCode ? [{ reportCode: f.reportCode }] : [])] };
  const [items, total] = await Promise.all([
    prisma().exportJob.findMany({ where, select: exportSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().exportJob.count({ where }),
  ]);
  return { items, total };
}

export async function updateJob(_scope: AnyScope, id: string, data: Prisma.ExportJobUncheckedUpdateInput): Promise<void> {
  await prisma().exportJob.update({ where: { id }, data });
}

/** Claims the next QUEUED job (worker); returns null when there is nothing to do. */
export async function claimNextQueued(_scope: AnyScope): Promise<ExportRow | null> {
  return prisma().$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM export_jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;
    const id = rows[0]?.id;
    if (!id) return null;
    return tx.exportJob.update({ where: { id }, data: { status: 'RUNNING' }, select: exportSelect });
  });
}

export async function expireJobs(_scope: AnyScope, now: Date): Promise<number> {
  const r = await prisma().exportJob.updateMany({ where: { status: 'COMPLETED', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
  return r.count;
}

export async function findExportDocument(_scope: AnyScope, documentId: string): Promise<{ storageBucket: string; storageKey: string; originalFilename: string; mimeType: string } | null> {
  return prisma().document.findUnique({ where: { id: documentId }, select: { storageBucket: true, storageKey: true, originalFilename: true, mimeType: true } });
}

export async function insertExportDocument(_scope: AnyScope, data: Prisma.DocumentUncheckedCreateInput): Promise<void> {
  await prisma().document.create({ data });
}
