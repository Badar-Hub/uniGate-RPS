import type { Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { prisma } from '@/database/prisma.js';

/**
 * Notifications (database.md §13.3). The inbox is SELF-scoped: every read and write is keyed
 * on the actor's own user id — there is no "read another user's inbox" path, global or not.
 * Templates and preferences are keyed the same way; delivery rows are written by the service
 * under a SYSTEM scope.
 */

export const notificationSelect = { id: true, userId: true, templateCode: true, channel: true, category: true, title: true, body: true, data: true, status: true, readAt: true, createdAt: true } satisfies Prisma.NotificationSelect;
export type NotificationRow = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;

export const templateSelect = { id: true, code: true, channel: true, locale: true, subject: true, body: true, variables: true, category: true, isActive: true, version: true, createdAt: true, updatedAt: true } satisfies Prisma.NotificationTemplateSelect;
export type TemplateRow = Prisma.NotificationTemplateGetPayload<{ select: typeof templateSelect }>;

function selfUserId(scope: AnyScope): string {
  if (scope.kind === 'SYSTEM') throw new Error('inbox reads require an actor');
  return scope.actor.userId;
}

// ── inbox (SELF) ─────────────────────────────────────────────────────────────

export async function listInbox(scope: AnyScope, q: { cursor?: string | undefined; pageSize: number; category?: string | undefined; unreadOnly: boolean; channel?: string | undefined }): Promise<{ items: NotificationRow[]; nextCursor: string | null }> {
  const userId = selfUserId(scope);
  // Cursor = createdAt epoch ms of the last row; ordering is (createdAt DESC, id DESC).
  const before = q.cursor ? new Date(Number(q.cursor)) : null;
  const rows = await prisma().notification.findMany({
    where: {
      userId, channel: (q.channel as NotificationRow['channel'] | undefined) ?? 'IN_APP',
      ...(q.category ? { category: q.category } : {}), ...(q.unreadOnly ? { readAt: null } : {}), ...(before && !Number.isNaN(before.getTime()) ? { createdAt: { lt: before } } : {}),
      status: { not: 'SUPPRESSED' },
    },
    select: notificationSelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.pageSize + 1,
  });
  const items = rows.slice(0, q.pageSize);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > q.pageSize && last ? String(last.createdAt.getTime()) : null };
}

export async function unreadCount(scope: AnyScope): Promise<{ total: number; byCategory: Record<string, number> }> {
  const userId = selfUserId(scope);
  const groups = await prisma().notification.groupBy({ by: ['category'], where: { userId, channel: 'IN_APP', readAt: null, status: { not: 'SUPPRESSED' } }, _count: { _all: true } });
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const g of groups) {
    byCategory[g.category] = g._count._all;
    total += g._count._all;
  }
  return { total, byCategory };
}

export async function markRead(scope: AnyScope, id: string): Promise<NotificationRow | null> {
  const userId = selfUserId(scope);
  const r = await prisma().notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
  if (r.count === 0) {
    const existing = await prisma().notification.findFirst({ where: { id, userId }, select: notificationSelect });
    return existing;
  }
  return prisma().notification.findFirst({ where: { id, userId }, select: notificationSelect });
}

export async function markAllRead(scope: AnyScope, category: string | undefined): Promise<number> {
  const userId = selfUserId(scope);
  const r = await prisma().notification.updateMany({ where: { userId, channel: 'IN_APP', readAt: null, ...(category ? { category } : {}) }, data: { readAt: new Date() } });
  return r.count;
}

export async function deleteOwn(scope: AnyScope, id: string): Promise<boolean> {
  const userId = selfUserId(scope);
  const r = await prisma().notification.deleteMany({ where: { id, userId } });
  return r.count > 0;
}

// ── preferences (SELF) ───────────────────────────────────────────────────────

export async function listPreferences(scope: AnyScope): Promise<{ category: string; channel: string; isEnabled: boolean }[]> {
  const userId = selfUserId(scope);
  return prisma().notificationPreference.findMany({ where: { userId }, select: { category: true, channel: true, isEnabled: true }, orderBy: [{ category: 'asc' }, { channel: 'asc' }] });
}

export async function upsertPreferences(scope: AnyScope, items: { category: string; channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH'; isEnabled: boolean }[]): Promise<void> {
  const userId = selfUserId(scope);
  await prisma().$transaction(items.map((p) => prisma().notificationPreference.upsert({ where: { userId_category_channel: { userId, category: p.category, channel: p.channel } }, create: { userId, category: p.category, channel: p.channel, isEnabled: p.isEnabled }, update: { isEnabled: p.isEnabled } })));
}

// ── delivery (SYSTEM) ────────────────────────────────────────────────────────

export interface RecipientRow {
  id: string;
  email: string | null;
  emailVerifiedAt: Date | null;
  phoneE164: string | null;
  phoneVerifiedAt: Date | null;
  preferredLocale: string;
  status: string;
  fullNameEn: string;
  preferences: { category: string; channel: string; isEnabled: boolean }[];
  deviceTokens: { token: string }[];
}

export async function findRecipients(_scope: AnyScope, userIds: string[]): Promise<RecipientRow[]> {
  if (!userIds.length) return [];
  return prisma().user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, emailVerifiedAt: true, phoneE164: true, phoneVerifiedAt: true, preferredLocale: true, status: true, fullNameEn: true, notificationPreferences: { select: { category: true, channel: true, isEnabled: true } }, deviceTokens: { where: { isActive: true }, select: { token: true } } },
  }).then((rows) => rows.map((r) => ({ ...r, preferences: r.notificationPreferences })));
}

/** Audience resolution for ops sends: explicit ids ∪ role holders ∪ profile types. */
export async function resolveAudience(_scope: AnyScope, a: { userIds?: string[] | undefined; roleCodes?: string[] | undefined; profileTypes?: ('CUSTOMER' | 'OWNER' | 'DRIVER' | 'SPO')[] | undefined }): Promise<string[]> {
  const or: Prisma.UserWhereInput[] = [];
  if (a.userIds?.length) or.push({ id: { in: a.userIds } });
  if (a.roleCodes?.length) or.push({ userRoles: { some: { role: { code: { in: a.roleCodes } } } } });
  for (const p of a.profileTypes ?? []) {
    if (p === 'CUSTOMER') or.push({ customerProfile: { isNot: null } });
    if (p === 'OWNER') or.push({ ownerProfile: { isNot: null } });
    if (p === 'DRIVER') or.push({ driverProfile: { isNot: null } });
    if (p === 'SPO') or.push({ spoProfile: { isNot: null } });
  }
  if (!or.length) return [];
  const rows = await prisma().user.findMany({ where: { OR: or, status: 'ACTIVE' }, select: { id: true }, take: 10_000 });
  return rows.map((r) => r.id);
}

export async function existsByDedupe(_scope: AnyScope, dedupeKey: string): Promise<boolean> {
  return (await prisma().notification.count({ where: { dedupeKey } })) > 0;
}

export async function insertMany(_scope: AnyScope, rows: Prisma.NotificationCreateManyInput[]): Promise<void> {
  if (!rows.length) return;
  await prisma().notification.createMany({ data: rows, skipDuplicates: true });
}

export interface QueuedRow {
  id: string;
  userId: string;
  templateCode: string;
  channel: string;
  category: string;
  title: string | null;
  body: string;
  data: Prisma.JsonValue;
}

export async function findQueued(_scope: AnyScope, ids: string[] | null, limit: number): Promise<QueuedRow[]> {
  return prisma().notification.findMany({ where: { status: 'QUEUED', channel: { not: 'IN_APP' }, ...(ids ? { id: { in: ids } } : {}) }, select: { id: true, userId: true, templateCode: true, channel: true, category: true, title: true, body: true, data: true }, orderBy: { createdAt: 'asc' }, take: limit });
}

export async function markDelivery(_scope: AnyScope, id: string, patch: { status: 'SENT' | 'FAILED' | 'SUPPRESSED'; providerMessageId?: string | null; errorMessage?: string | null }): Promise<void> {
  await prisma().notification.updateMany({ where: { id, status: 'QUEUED' }, data: { status: patch.status, providerMessageId: patch.providerMessageId ?? null, errorMessage: patch.errorMessage ?? null, ...(patch.status === 'SENT' ? { sentAt: new Date() } : {}) } });
}

export async function deactivateDeviceTokens(_scope: AnyScope, tokens: string[]): Promise<void> {
  if (!tokens.length) return;
  await prisma().deviceToken.updateMany({ where: { token: { in: tokens } }, data: { isActive: false } });
}

export async function purgeOlderThan(_scope: AnyScope, before: Date): Promise<number> {
  const r = await prisma().notification.deleteMany({ where: { createdAt: { lt: before } } });
  return r.count;
}

// ── templates (GLOBAL: notifications.templates.manage) ───────────────────────

export async function findTemplates(_scope: AnyScope, code: string, locale: string): Promise<TemplateRow[]> {
  return prisma().notificationTemplate.findMany({ where: { code, isActive: true, locale: { in: [locale, 'en', 'ar'] } }, select: templateSelect });
}

export async function findTemplate(_scope: AnyScope, id: string): Promise<TemplateRow | null> {
  return prisma().notificationTemplate.findUnique({ where: { id }, select: templateSelect });
}

export async function listTemplates(_scope: AnyScope, f: { code?: string | undefined; channel?: string | undefined; locale?: string | undefined; category?: string | undefined; isActive?: boolean | undefined }, page: { page: number; pageSize: number }): Promise<{ items: TemplateRow[]; total: number }> {
  const where: Prisma.NotificationTemplateWhereInput = {
    ...(f.code ? { code: f.code } : {}), ...(f.channel ? { channel: f.channel as TemplateRow['channel'] } : {}), ...(f.locale ? { locale: f.locale } : {}), ...(f.category ? { category: f.category } : {}), ...(f.isActive !== undefined ? { isActive: f.isActive } : {}),
  };
  const [items, total] = await Promise.all([
    prisma().notificationTemplate.findMany({ where, select: templateSelect, orderBy: [{ code: 'asc' }, { channel: 'asc' }, { locale: 'asc' }], skip: (page.page - 1) * page.pageSize, take: page.pageSize }),
    prisma().notificationTemplate.count({ where }),
  ]);
  return { items, total };
}

export async function createTemplate(_scope: AnyScope, data: Prisma.NotificationTemplateUncheckedCreateInput): Promise<TemplateRow> {
  return prisma().notificationTemplate.create({ data, select: templateSelect });
}

export async function updateTemplate(_scope: AnyScope, id: string, data: Prisma.NotificationTemplateUncheckedUpdateInput): Promise<TemplateRow> {
  return prisma().notificationTemplate.update({ where: { id }, data: { ...data, version: { increment: 1 } }, select: templateSelect });
}

export async function templateCodes(_scope: AnyScope): Promise<{ code: string; category: string }[]> {
  const rows = await prisma().notificationTemplate.findMany({ where: { isActive: true }, select: { code: true, category: true }, distinct: ['code'], orderBy: { code: 'asc' } });
  return rows;
}

// ── device tokens (SELF) ─────────────────────────────────────────────────────

export async function upsertDeviceToken(scope: AnyScope, input: { id: string; token: string; platform: 'IOS' | 'ANDROID' | 'WEB'; appVersion: string | null }): Promise<void> {
  const userId = selfUserId(scope);
  await prisma().deviceToken.upsert({ where: { token: input.token }, create: { id: input.id, userId, token: input.token, platform: input.platform, appVersion: input.appVersion, lastUsedAt: new Date() }, update: { userId, platform: input.platform, appVersion: input.appVersion, isActive: true, lastUsedAt: new Date() } });
}

export async function removeDeviceToken(scope: AnyScope, token: string): Promise<void> {
  const userId = selfUserId(scope);
  await prisma().deviceToken.updateMany({ where: { token, userId }, data: { isActive: false } });
}
