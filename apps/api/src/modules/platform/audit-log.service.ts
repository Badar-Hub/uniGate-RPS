import type { ActorScope, AuditLogDto, ExportJobDto } from '@unigate/types';
import type { auditExportBody, listAuditLogsQuery } from '@unigate/validation';
import type { z } from 'zod';
import { requestExport } from '@/modules/reporting/reporting.service.js';
import * as repo from './audit.repository.js';
import { writeAudit } from './audit.service.js';

/** Audit log explorer (api.md §8.30). Reading the trail is itself audited; exports go through the reports export pipeline (max 90 days). */

const json = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

function toDto(r: repo.AuditRow, names: Map<string, string>): AuditLogDto {
  return { id: r.id, occurredAt: r.occurredAt.toISOString(), actorUserId: r.actorUserId, actorName: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null, actorType: r.actorType, actorRoles: r.actorRoles, action: r.action, entityType: r.entityType, entityId: r.entityId, severity: r.severity, beforeValue: json(r.beforeValue), afterValue: json(r.afterValue), changedFields: r.changedFields, ipAddress: r.ipAddress, userAgent: r.userAgent, requestId: r.requestId };
}

export async function list(scope: ActorScope, q: z.infer<typeof listAuditLogsQuery>): Promise<{ items: AuditLogDto[]; nextCursor: string | null }> {
  const { items, nextCursor } = await repo.list(scope, q, q);
  const names = await repo.actorNames(scope, items.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])));
  // The first page of a query is audited (subsequent cursor pages are the same query).
  if (!q.cursor) await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'audit_log.viewed', entityType: 'audit_log', entityId: 'list', afterValue: { filters: { actorUserId: q.actorUserId ?? null, action: q.action ?? null, entityType: q.entityType ?? null, entityId: q.entityId ?? null, severity: q.severity ?? null, dateFrom: q.dateFrom ?? null, dateTo: q.dateTo ?? null } } });
  return { items: items.map((r) => toDto(r, names)), nextCursor };
}

export async function entityHistory(scope: ActorScope, entityType: string, entityId: string): Promise<AuditLogDto[]> {
  const rows = await repo.entityHistory(scope, entityType, entityId);
  const names = await repo.actorNames(scope, rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])));
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'audit_log.viewed', entityType: 'audit_log', entityId: `${entityType}/${entityId}`, afterValue: { rows: rows.length } });
  return rows.map((r) => toDto(r, names));
}

export async function exportLogs(scope: ActorScope, body: z.infer<typeof auditExportBody>): Promise<ExportJobDto> {
  return requestExport(scope, 'audit-logs', { format: 'CSV', filters: body });
}
