import type { Prisma, UserStatus } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * User reads for iam. `SELF`-scoped reads bind to the actor's own id; `GLOBAL` (users.read)
 * may address any id. There is no path that returns a row outside the scope.
 */
export const userWithProfiles = {
  id: true, email: true, emailVerifiedAt: true, phoneE164: true, phoneVerifiedAt: true, fullNameEn: true, fullNameAr: true,
  status: true, preferredLocale: true, timezone: true, permissionVersion: true, lastLoginAt: true, createdAt: true, updatedAt: true, deletedAt: true,
  customerProfile: { select: { id: true, customerType: true } },
  ownerProfile: { select: { id: true, onboardingStatus: true, isPlatformFleet: true } },
  driverProfile: { select: { id: true, approvalStatus: true } },
  spoProfile: { select: { id: true, employeeCode: true } },
  userRoles: { select: { role: { select: { code: true } } } },
} satisfies Prisma.UserSelect;

export type UserWithProfiles = Prisma.UserGetPayload<{ select: typeof userWithProfiles }>;

function scopeWhere(scope: AnyScope, id: string): Prisma.UserWhereInput {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return { id };
  // SELF / OWN / PARTY: only the actor's own user row.
  return { id: scope.actor.userId === id ? id : '00000000-0000-0000-0000-000000000000' };
}

export async function findUserById(scope: AnyScope, id: string): Promise<UserWithProfiles | null> {
  return prisma().user.findFirst({ where: { ...scopeWhere(scope, id), deletedAt: null }, select: userWithProfiles });
}

/** Login lookup by email or phone. Unscoped by nature (pre-authentication) — SYSTEM scope only. */
export async function findUserForLogin(scope: AnyScope, identifier: string) {
  if (scope.kind !== 'SYSTEM') throw new Error('findUserForLogin requires SYSTEM scope');
  const isEmail = identifier.includes('@');
  return prisma().user.findFirst({
    where: { ...(isEmail ? { email: identifier } : { phoneE164: identifier }), deletedAt: null },
    select: { id: true, passwordHash: true, status: true, phoneVerifiedAt: true, emailVerifiedAt: true, preferredLocale: true },
  });
}

/** Self-service profile fields only (name, locale, timezone); identity fields have their own flows. */
export async function updateSelfProfile(
  scope: AnyScope,
  id: string,
  patch: { fullNameEn?: string; fullNameAr?: string | null; preferredLocale?: string; timezone?: string },
): Promise<void> {
  await prisma().user.updateMany({ where: { ...scopeWhere(scope, id), deletedAt: null }, data: patch });
}

export async function identifierTaken(scope: AnyScope, input: { email?: string | null; phoneE164?: string | null }): Promise<boolean> {
  if (scope.kind !== 'SYSTEM' && scope.kind !== 'GLOBAL') throw new Error('identifierTaken requires SYSTEM or GLOBAL scope');
  const or: Prisma.UserWhereInput[] = [];
  if (input.email) or.push({ email: input.email });
  if (input.phoneE164) or.push({ phoneE164: input.phoneE164 });
  if (!or.length) return false;
  const hit = await prisma().user.findFirst({ where: { OR: or, deletedAt: null }, select: { id: true } });
  return Boolean(hit);
}

export async function listUsers(
  scope: AnyScope,
  filters: { status?: string | undefined; roleCode?: string | undefined; q?: string | undefined },
  page: { page: number; pageSize: number },
): Promise<{ items: UserWithProfiles[]; total: number }> {
  if (scope.kind !== 'GLOBAL' && scope.kind !== 'SYSTEM') return { items: [], total: 0 };
  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    ...(filters.status ? { status: filters.status as UserStatus } : {}),
    ...(filters.roleCode ? { userRoles: { some: { role: { code: filters.roleCode } } } } : {}),
    ...(filters.q
      ? { OR: [{ fullNameEn: { contains: filters.q, mode: 'insensitive' } }, { fullNameAr: { contains: filters.q } }, { email: { contains: filters.q, mode: 'insensitive' } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma().user.findMany({ where, select: userWithProfiles, orderBy: { createdAt: 'desc' }, skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().user.count({ where }),
  ]);
  return { items, total };
}
