import { Prisma } from '@prisma/client';
import type { ActorType, AuditSeverity } from '@unigate/types';
import { redact } from '@/common/redact.js';
import { getContext } from '@/common/request-context.js';
import { newId } from '@/common/ids.js';
import { prisma } from '@/database/prisma.js';

/**
 * The audit writer (security.md §8.3). before/after pass through the shared redact() so a
 * banned key can never be persisted. Written inside the caller's transaction when one is
 * supplied, so "the change happened but the audit did not" is impossible.
 */
export interface AuditEntry {
  actorUserId: string | null;
  actorType: ActorType;
  actorRoles?: string[];
  action: string;
  entityType: string;
  entityId: string;
  severity?: AuditSeverity;
  beforeValue?: Record<string, unknown> | null;
  afterValue?: Record<string, unknown> | null;
  changedFields?: string[];
  ipAddress?: string | null;
  userAgent?: string | null;
}

export async function writeAudit(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
  const ctx = getContext();
  const db = tx ?? prisma();
  await db.auditLog.create({
    data: {
      id: newId(),
      actorUserId: entry.actorUserId,
      actorType: entry.actorType,
      actorRoles: entry.actorRoles ?? [],
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      beforeValue: entry.beforeValue ? (redact(entry.beforeValue) as Prisma.InputJsonValue) : Prisma.JsonNull,
      afterValue: entry.afterValue ? (redact(entry.afterValue) as Prisma.InputJsonValue) : Prisma.JsonNull,
      changedFields: entry.changedFields ?? [],
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
      requestId: ctx?.requestId ?? null,
      severity: entry.severity ?? 'INFO',
      occurredAt: new Date(),
    },
  });
}
