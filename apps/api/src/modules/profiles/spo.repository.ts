import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/** SPO profiles, customer assignments, leads and commission lines (database.md §6.2, api.md §8.7). */

export const spoSelect = {
  id: true, userId: true, employeeCode: true, regionId: true, managerUserId: true, commissionModelId: true, isActive: true, createdAt: true, updatedAt: true,
  user: { select: { fullNameEn: true, email: true, deletedAt: true } },
  _count: { select: { assignments: { where: { unassignedAt: null } } } },
} satisfies Prisma.SpoProfileSelect;
export type SpoRow = Prisma.SpoProfileGetPayload<{ select: typeof spoSelect }>;

export const leadSelect = {
  id: true, spoProfileId: true, contactName: true, contactPhone: true, companyName: true, status: true, convertedUserId: true, notes: true, createdAt: true, updatedAt: true,
} satisfies Prisma.SpoLeadSelect;
export type LeadRow = Prisma.SpoLeadGetPayload<{ select: typeof leadSelect }>;

export const assignmentSelect = {
  id: true, spoProfileId: true, customerProfileId: true, assignedAt: true, unassignedAt: true,
  customerProfile: { select: { user: { select: { fullNameEn: true } } } },
} satisfies Prisma.SpoCustomerAssignmentSelect;
export type AssignmentRow = Prisma.SpoCustomerAssignmentGetPayload<{ select: typeof assignmentSelect }>;

function ownSpoId(scope: AnyScope): string {
  return scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? '' : (scope.actor.spoProfileId ?? '00000000-0000-0000-0000-000000000000');
}

export function scopeWhere(scope: AnyScope): Prisma.SpoProfileWhereInput {
  return scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? {} : { id: ownSpoId(scope) };
}

export async function findSpo(scope: AnyScope, id: string): Promise<SpoRow | null> {
  return prisma().spoProfile.findFirst({ where: { AND: [{ id }, scopeWhere(scope)], user: { deletedAt: null } }, select: spoSelect });
}

export async function listSpos(scope: AnyScope, f: { regionId?: string | undefined; isActive?: boolean | undefined; q?: string | undefined }, page: { page: number; pageSize: number }) {
  const where: Prisma.SpoProfileWhereInput = {
    ...scopeWhere(scope),
    user: { deletedAt: null },
    ...(f.regionId ? { regionId: f.regionId } : {}),
    ...(f.isActive !== undefined ? { isActive: f.isActive } : {}),
    ...(f.q ? { OR: [{ employeeCode: { contains: f.q, mode: 'insensitive' } }, { user: { fullNameEn: { contains: f.q, mode: 'insensitive' } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma().spoProfile.findMany({ where, select: spoSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().spoProfile.count({ where }),
  ]);
  return { items, total };
}

export async function listAssignments(scope: AnyScope, spoProfileId: string): Promise<AssignmentRow[] | null> {
  const spo = await prisma().spoProfile.findFirst({ where: { AND: [{ id: spoProfileId }, scopeWhere(scope)] }, select: { id: true } });
  if (!spo) return null;
  return prisma().spoCustomerAssignment.findMany({ where: { spoProfileId, unassignedAt: null }, select: assignmentSelect, orderBy: { assignedAt: 'desc' } });
}

export function leadScopeWhere(scope: AnyScope): Prisma.SpoLeadWhereInput {
  return scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? {} : { spoProfileId: ownSpoId(scope) };
}

export async function findLead(scope: AnyScope, id: string): Promise<LeadRow | null> {
  return prisma().spoLead.findFirst({ where: { id, ...leadScopeWhere(scope) }, select: leadSelect });
}

export async function listLeads(scope: AnyScope, f: { status?: string | undefined; spoProfileId?: string | undefined; q?: string | undefined }, page: { page: number; pageSize: number }) {
  const where: Prisma.SpoLeadWhereInput = {
    ...leadScopeWhere(scope),
    ...(f.status ? { status: f.status as LeadRow['status'] } : {}),
    ...(f.spoProfileId ? { spoProfileId: f.spoProfileId } : {}),
    ...(f.q ? { OR: [{ contactName: { contains: f.q, mode: 'insensitive' } }, { companyName: { contains: f.q, mode: 'insensitive' } }, { contactPhone: { contains: f.q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma().spoLead.findMany({ where, select: leadSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().spoLead.count({ where }),
  ]);
  return { items, total };
}

/** Commission lines come from booking_financial_snapshots — the frozen figures, never recomputed. */
export async function listCommissionLines(scope: AnyScope, f: { spoProfileId?: string | undefined; dateFrom?: string | undefined; dateTo?: string | undefined }, page: { page: number; pageSize: number }) {
  const spoFilter = scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? f.spoProfileId : ownSpoId(scope);
  const where: Prisma.BookingFinancialSnapshotWhereInput = {
    spoCommissionAmount: { gt: 0 },
    booking: { attributedSpoProfileId: spoFilter ?? { not: null } },
    ...(f.dateFrom ? { computedAt: { gte: new Date(f.dateFrom) } } : {}),
    ...(f.dateTo ? { computedAt: { lte: new Date(`${f.dateTo}T23:59:59.999Z`) } } : {}),
  };
  const select = {
    bookingId: true, spoCommissionAmount: true, spoRuleSnapshot: true, computedAt: true,
    booking: { select: { attributedSpoProfileId: true, customerProfileId: true } },
  } satisfies Prisma.BookingFinancialSnapshotSelect;
  const [items, total] = await Promise.all([
    prisma().bookingFinancialSnapshot.findMany({ where, select, orderBy: { computedAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().bookingFinancialSnapshot.count({ where }),
  ]);
  return { items, total };
}
export type CommissionRow = Awaited<ReturnType<typeof listCommissionLines>>['items'][number];
