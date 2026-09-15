import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/** Audit log reads (api.md §8.30). GLOBAL only — the route gates on audit_logs.read; the table is append-only at the DB-role level. */

export const auditSelect = { id: true, occurredAt: true, actorUserId: true, actorType: true, actorRoles: true, action: true, entityType: true, entityId: true, severity: true, beforeValue: true, afterValue: true, changedFields: true, ipAddress: true, userAgent: true, requestId: true } satisfies Prisma.AuditLogSelect;
export type AuditRow = Prisma.AuditLogGetPayload<{ select: typeof auditSelect }>;

export interface AuditFilters {
  actorUserId?: string | undefined;
  action?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  severity?: string | undefined;
  requestId?: string | undefined;
  ipAddress?: string | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

/** Cursor = "<occurredAtMs>:<id>" of the last row; ordering is (occurredAt DESC, id DESC). */
export async function list(_scope: AnyScope, f: AuditFilters, q: { cursor?: string | undefined; pageSize: number }): Promise<{ items: AuditRow[]; nextCursor: string | null }> {
  const [ms, id] = q.cursor ? q.cursor.split(':', 2) : [];
  const cursorAt = ms && id ? new Date(Number(ms)) : null;
  const where: Prisma.AuditLogWhereInput = {
    ...(f.actorUserId ? { actorUserId: f.actorUserId } : {}), ...(f.action ? { action: { startsWith: f.action } } : {}), ...(f.entityType ? { entityType: f.entityType } : {}), ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.severity ? { severity: f.severity as AuditRow['severity'] } : {}), ...(f.requestId ? { requestId: f.requestId } : {}), ...(f.ipAddress ? { ipAddress: f.ipAddress } : {}),
    ...(f.dateFrom || f.dateTo ? { occurredAt: { ...(f.dateFrom ? { gte: new Date(f.dateFrom) } : {}), ...(f.dateTo ? { lte: new Date(f.dateTo) } : {}) } } : {}),
    ...(cursorAt && id ? { OR: [{ occurredAt: { lt: cursorAt } }, { occurredAt: cursorAt, id: { lt: id } }] } : {}),
  };
  const rows = await prisma().auditLog.findMany({ where, select: auditSelect, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: q.pageSize + 1 });
  const items = rows.slice(0, q.pageSize);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > q.pageSize && last ? `${last.occurredAt.getTime()}:${last.id}` : null };
}

export async function entityHistory(_scope: AnyScope, entityType: string, entityId: string): Promise<AuditRow[]> {
  return prisma().auditLog.findMany({ where: { entityType, entityId }, select: auditSelect, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: 500 });
}

export async function actorNames(_scope: AnyScope, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (!ids.length) return new Map();
  const rows = await prisma().user.findMany({ where: { id: { in: ids } }, select: { id: true, fullNameEn: true } });
  return new Map(rows.map((r) => [r.id, r.fullNameEn]));
}
