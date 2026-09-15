import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Driver profiles (database.md §6.2). OWN scope = drivers belonging to the acting owner, or
 * the driver themselves (SELF); `drivers.read_any` (GLOBAL) sees all.
 */

export const driverSelect = {
  id: true, userId: true, ownerProfileId: true, idType: true, nationalIdLast4: true, dateOfBirth: true, licenseNumberLast4: true,
  licenseExpiryDate: true, licenseCategories: true, approvalStatus: true, availabilityStatus: true, ratingAvg: true, ratingCount: true,
  emergencyContactName: true, emergencyContactPhone: true, createdAt: true, updatedAt: true,
  user: { select: { fullNameEn: true, fullNameAr: true, phoneE164: true, email: true, status: true, deletedAt: true } },
  verticalEligibility: { select: { transportType: true, status: true, approvedAt: true }, orderBy: { transportType: 'asc' } },
} satisfies Prisma.DriverProfileSelect;

export type DriverRow = Prisma.DriverProfileGetPayload<{ select: typeof driverSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.DriverProfileWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  const a = scope.actor;
  const or: Prisma.DriverProfileWhereInput[] = [];
  if (a.driverProfileId) or.push({ id: a.driverProfileId });
  if (a.ownerProfileId && scope.kind !== 'SELF') or.push({ ownerProfileId: a.ownerProfileId });
  return or.length ? { OR: or } : { id: '00000000-0000-0000-0000-000000000000' };
}

export async function findDriver(scope: AnyScope, id: string): Promise<DriverRow | null> {
  return prisma().driverProfile.findFirst({ where: { AND: [{ id }, scopeWhere(scope)], user: { deletedAt: null } }, select: driverSelect });
}

export interface DriverFilters {
  approvalStatus?: string | undefined;
  availabilityStatus?: string | undefined;
  ownerProfileId?: string | undefined;
  licenseExpiringWithinDays?: number | undefined;
  q?: string | undefined;
}

export async function listDrivers(scope: AnyScope, f: DriverFilters, page: { page: number; pageSize: number }): Promise<{ items: DriverRow[]; total: number }> {
  const where: Prisma.DriverProfileWhereInput = {
    ...scopeWhere(scope),
    user: { deletedAt: null },
    ...(f.approvalStatus ? { approvalStatus: f.approvalStatus as DriverRow['approvalStatus'] } : {}),
    ...(f.availabilityStatus ? { availabilityStatus: f.availabilityStatus as DriverRow['availabilityStatus'] } : {}),
    ...(f.ownerProfileId ? { ownerProfileId: f.ownerProfileId } : {}),
    ...(f.licenseExpiringWithinDays ? { licenseExpiryDate: { lte: new Date(Date.now() + f.licenseExpiringWithinDays * 86_400_000) } } : {}),
    ...(f.q
      ? { OR: [{ user: { fullNameEn: { contains: f.q, mode: 'insensitive' } } }, { user: { fullNameAr: { contains: f.q } } }, { user: { phoneE164: { contains: f.q } } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma().driverProfile.findMany({ where, select: driverSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().driverProfile.count({ where }),
  ]);
  return { items, total };
}

export async function listAssignments(scope: AnyScope, driverProfileId: string) {
  const driver = await prisma().driverProfile.findFirst({ where: { AND: [{ id: driverProfileId }, scopeWhere(scope)] }, select: { id: true } });
  if (!driver) return null;
  return prisma().vehicleDriverAssignment.findMany({
    where: { driverProfileId },
    select: { id: true, vehicleId: true, assignedFrom: true, assignedTo: true, assignedByUserId: true },
    orderBy: { assignedFrom: 'desc' },
  });
}
