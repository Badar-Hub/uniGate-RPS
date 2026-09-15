import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/** Owner profiles, verticals, service areas and payout accounts (database.md §6.2, §12.x). */

export const ownerSelect = {
  id: true, userId: true, ownerType: true, isPlatformFleet: true, businessNameEn: true, businessNameAr: true, crNumber: true, vatNumber: true,
  isVatRegistered: true, vatVerifiedAt: true, nationalIdLast4: true, onboardingStatus: true, approvedByUserId: true, approvedAt: true,
  rejectionReason: true, ratingAvg: true, ratingCount: true, privacySettings: true, defaultPayoutAccountId: true, createdAt: true, updatedAt: true,
  user: { select: { fullNameEn: true, fullNameAr: true, phoneE164: true, email: true, status: true, deletedAt: true } },
  verticalApprovals: { select: { transportType: true, status: true, approvedAt: true, notes: true }, orderBy: { transportType: 'asc' } },
  serviceAreas: { where: { isActive: true }, select: { cityId: true } },
  _count: { select: { vehicles: true } },
} satisfies Prisma.OwnerProfileSelect;

export type OwnerRow = Prisma.OwnerProfileGetPayload<{ select: typeof ownerSelect }>;

export const bankAccountSelect = {
  id: true, accountHolderName: true, bankName: true, ibanLast4: true, isVerified: true, isDefault: true, activationAt: true, createdAt: true,
} satisfies Prisma.OwnerBankAccountSelect;
export type BankAccountRow = Prisma.OwnerBankAccountGetPayload<{ select: typeof bankAccountSelect }>;

export function scopeWhere(scope: AnyScope): Prisma.OwnerProfileWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return {};
  return { id: scope.actor.ownerProfileId ?? '00000000-0000-0000-0000-000000000000' };
}

export async function findOwner(scope: AnyScope, id: string): Promise<OwnerRow | null> {
  return prisma().ownerProfile.findFirst({ where: { AND: [{ id }, scopeWhere(scope)], user: { deletedAt: null } }, select: ownerSelect });
}

export interface OwnerFilters {
  ownerType?: string | undefined;
  onboardingStatus?: string | undefined;
  cityId?: string | undefined;
  q?: string | undefined;
}

export async function listOwners(scope: AnyScope, f: OwnerFilters, page: { page: number; pageSize: number }): Promise<{ items: OwnerRow[]; total: number }> {
  const where: Prisma.OwnerProfileWhereInput = {
    ...scopeWhere(scope),
    user: { deletedAt: null },
    ...(f.ownerType ? { ownerType: f.ownerType as OwnerRow['ownerType'] } : {}),
    ...(f.onboardingStatus ? { onboardingStatus: f.onboardingStatus as OwnerRow['onboardingStatus'] } : {}),
    ...(f.cityId ? { serviceAreas: { some: { cityId: f.cityId, isActive: true } } } : {}),
    ...(f.q
      ? {
          OR: [
            { businessNameEn: { contains: f.q, mode: 'insensitive' } },
            { businessNameAr: { contains: f.q } },
            { crNumber: { contains: f.q } },
            { user: { fullNameEn: { contains: f.q, mode: 'insensitive' } } },
            { user: { phoneE164: { contains: f.q } } },
            { user: { email: { contains: f.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma().ownerProfile.findMany({ where, select: ownerSelect, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().ownerProfile.count({ where }),
  ]);
  return { items, total };
}

export async function listBankAccounts(scope: AnyScope, ownerProfileId: string): Promise<BankAccountRow[] | null> {
  const owner = await prisma().ownerProfile.findFirst({ where: { AND: [{ id: ownerProfileId }, scopeWhere(scope)] }, select: { id: true } });
  if (!owner) return null;
  return prisma().ownerBankAccount.findMany({ where: { ownerProfileId, deletedAt: null }, select: bankAccountSelect, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
}
