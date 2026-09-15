import type { Prisma, SettingsSection, SystemSetting } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Settings are platform-wide, so scope only decides which SCOPE column values are visible:
 * SECRET rows are never returned to anyone (security.md §7.1), and PUBLIC-only reads are used
 * by the unauthenticated endpoint. The ActorScope parameter is still required by the
 * repository rule so the signature stays uniform.
 */
export type SettingRow = SystemSetting;

function visibleScopes(scope: AnyScope, publicOnly: boolean): ('PUBLIC' | 'INTERNAL')[] {
  if (publicOnly) return ['PUBLIC'];
  return scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' ? ['PUBLIC', 'INTERNAL'] : ['PUBLIC'];
}

export async function listSettings(
  scope: AnyScope,
  opts: { section?: string; publicOnly?: boolean } = {},
): Promise<SettingRow[]> {
  const where: Prisma.SystemSettingWhereInput = {
    scope: { in: visibleScopes(scope, opts.publicOnly ?? false) },
    ...(opts.section ? { section: opts.section as SettingsSection } : {}),
  };
  return prisma().systemSetting.findMany({ where, orderBy: [{ section: 'asc' }, { key: 'asc' }] });
}

export async function findSetting(scope: AnyScope, key: string): Promise<SettingRow | null> {
  return prisma().systemSetting.findFirst({
    where: { key, scope: { in: visibleScopes(scope, false) } },
  });
}

/** All non-secret values as a map — used for cross-field validation. */
export async function allValues(scope: AnyScope): Promise<Map<string, unknown>> {
  const rows = await listSettings(scope);
  return new Map(rows.map((r) => [r.key, r.value as unknown]));
}

export async function updateSettingValue(
  scope: AnyScope,
  key: string,
  value: Prisma.InputJsonValue,
  updatedByUserId: string | null,
): Promise<SettingRow> {
  // Platform-wide row; the service has already applied the scope's visibility rule.
  visibleScopes(scope, false);
  return prisma().systemSetting.update({
    where: { key },
    data: { value, updatedByUserId, updatedAt: new Date() },
  });
}

export async function sectionSummary(scope: AnyScope): Promise<{ section: string; keyCount: number; lastChangedAt: Date | null }[]> {
  const rows = await prisma().systemSetting.groupBy({
    by: ['section'],
    where: { scope: { in: visibleScopes(scope, false) } },
    _count: { key: true },
    _max: { updatedAt: true },
    orderBy: { section: 'asc' },
  });
  return rows.map((r) => ({ section: r.section, keyCount: r._count.key, lastChangedAt: r._max.updatedAt }));
}
