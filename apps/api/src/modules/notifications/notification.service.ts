import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, NotificationDto, NotificationPreferenceDto, NotificationPreviewDto, NotificationSendResultDto, NotificationTemplateDto, NotificationUnreadCountDto } from '@unigate/types';
import type { createNotificationTemplateBody, listNotificationTemplatesQuery, listNotificationsQuery, patchNotificationTemplateBody, putNotificationPreferencesBody, registerDeviceTokenBody, sendNotificationBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { isPushConfigured, emailProvider, pushProvider, smsProvider } from '@/integrations/notifications/index.js';
import { logger } from '@/logging/logger.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { emitToRoom } from '@/realtime/hub.js';
import { toNotificationDto, toTemplateDto } from './notification.mapper.js';
import * as repo from './notification.repository.js';
import { enqueueDelivery } from './notifications.jobs.js';
import { placeholdersIn, render } from './render.js';

/**
 * Notifications (api.md §8.26, BRIEF-§23). Business code never writes message text: it calls
 * `notify()` with a template code and variables; this service resolves recipients, locale,
 * preferences, channels and quiet hours, persists one row per (user, channel) and hands the
 * off-platform channels to the delivery worker. IN_APP is delivered by the row itself.
 */

export type Channel = 'IN_APP' | 'EMAIL' | 'SMS' | 'PUSH';
const CHANNELS: Channel[] = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'];
export const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'notifications', requestId: 'internal' };

export interface NotifyInput {
  userIds: string[];
  templateCode: string;
  variables: Record<string, string>;
  /** Locale-specific overrides (labels, dates) merged over `variables` per recipient. */
  variablesByLocale?: { ar?: Record<string, string>; en?: Record<string, string> } | undefined;
  /** Deep-link hints stored beside the row and pushed to devices — never a secret. */
  data?: Record<string, unknown> | undefined;
  /** Retry safety (FR-NOTIFICATIONS-05): the same key never produces a second row per user × channel. */
  dedupeKey?: string | undefined;
  channels?: Channel[] | undefined;
  /** Bypass quiet hours and preferences — operational emergencies only. */
  urgent?: boolean | undefined;
}

interface Policy {
  enabled: Set<Channel>;
  locked: Set<string>;
  urgentCategories: Set<string>;
  quietHours: { from: string; to: string } | null;
  smsSenderId: string | null;
}

async function policy(): Promise<Policy> {
  const [enabled, locked, urgent, quiet, sender] = await Promise.all([
    getSettingValue<Channel[]>('notifications.enabled_channels', CHANNELS),
    getSettingValue<string[]>('notifications.locked_categories', ['SECURITY', 'PAYMENT', 'TRIP']),
    getSettingValue<string[]>('notifications.urgent_categories', ['SECURITY', 'PAYMENT', 'TRIP']),
    getSettingValue<{ from: string; to: string } | null>('notifications.quiet_hours', null),
    getSettingValue<string>('notifications.sms_sender_id', ''),
  ]);
  return { enabled: new Set(enabled), locked: new Set(locked), urgentCategories: new Set(urgent), quietHours: quiet, smsSenderId: sender || null };
}

/** Milliseconds until quiet hours end (Asia/Riyadh wall clock), 0 when outside them. */
export function quietDelayMs(q: { from: string; to: string } | null, now = new Date()): number {
  if (!q) return 0;
  const riyadh = new Date(now.getTime() + 3 * 3_600_000);
  const minutes = riyadh.getUTCHours() * 60 + riyadh.getUTCMinutes();
  const [fh, fm] = q.from.split(':').map(Number);
  const [th, tm] = q.to.split(':').map(Number);
  const from = (fh ?? 0) * 60 + (fm ?? 0);
  const to = (th ?? 0) * 60 + (tm ?? 0);
  const inside = from <= to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  if (!inside) return 0;
  const untilEnd = to > minutes ? to - minutes : 24 * 60 - minutes + to;
  return untilEnd * 60_000;
}

function pickTemplate(rows: repo.TemplateRow[], channel: Channel, locale: string): repo.TemplateRow | null {
  const forChannel = rows.filter((t) => t.channel === channel);
  return forChannel.find((t) => t.locale === locale) ?? forChannel.find((t) => t.locale === 'en') ?? forChannel[0] ?? null;
}

function reachable(u: repo.RecipientRow, channel: Channel): string | null {
  switch (channel) {
    case 'IN_APP':
      return null;
    case 'EMAIL':
      return u.email ? null : 'no email address';
    case 'SMS':
      return u.phoneE164 ? null : 'no phone number';
    case 'PUSH':
      if (!isPushConfigured()) return 'push provider not configured';
      return u.deviceTokens.length ? null : 'no device token';
  }
}

/** Renders a template for a user; `[secret]` variables are substituted for delivery only, never persisted. */
function renderFor(t: repo.TemplateRow, variables: Record<string, string>): { title: string | null; body: string; missing: string[] } {
  const subject = t.subject ? render(t.subject, variables) : null;
  const body = render(t.body, variables);
  return { title: subject?.text ?? null, body: body.text, missing: [...new Set([...(subject?.missing ?? []), ...body.missing])] };
}

export async function notify(input: NotifyInput): Promise<{ recipients: number; queued: number; suppressed: number }> {
  const users = (await repo.findRecipients(systemScope, [...new Set(input.userIds)])).filter((u) => u.status !== 'DEACTIVATED');
  if (!users.length) return { recipients: 0, queued: 0, suppressed: 0 };
  const p = await policy();
  const defaultLocale = await getSettingValue<string>('notifications.default_locale', 'ar');
  const templates = await repo.findTemplates(systemScope, input.templateCode, defaultLocale);
  if (!templates.length) {
    logger().warn({ templateCode: input.templateCode }, 'notify: no active template — nothing sent');
    return { recipients: users.length, queued: 0, suppressed: 0 };
  }
  const category = templates[0]?.category ?? 'GENERAL';
  const urgent = Boolean(input.urgent) || p.urgentCategories.has(category);
  const wanted = input.channels ?? CHANNELS;
  const rows: Prisma.NotificationCreateManyInput[] = [];
  const deliver: string[] = [];
  const inApp: { userId: string; row: Prisma.NotificationCreateManyInput }[] = [];
  let suppressed = 0;
  for (const u of users) {
    const locale = u.preferredLocale === 'en' || u.preferredLocale === 'ar' ? u.preferredLocale : defaultLocale;
    for (const channel of wanted) {
      const t = pickTemplate(templates, channel, locale);
      if (!t) continue;
      const rendered = renderFor(t, { ...input.variables, ...(input.variablesByLocale?.[locale as 'ar' | 'en'] ?? {}) });
      if (rendered.missing.length) logger().warn({ templateCode: t.code, channel, missing: rendered.missing }, 'notify: template variables missing');
      const pref = u.preferences.find((x) => x.category === category && x.channel === channel);
      const suppressedBy = !p.enabled.has(channel) ? 'channel disabled' : pref && !pref.isEnabled && !p.locked.has(category) && !input.urgent ? 'user preference' : reachable(u, channel);
      const id = newId();
      const base: Prisma.NotificationCreateManyInput = {
        id, userId: u.id, templateCode: t.code, channel, category, title: rendered.title, body: rendered.body, data: (input.data ?? {}) as Prisma.InputJsonValue,
        dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${u.id}:${channel}`.slice(0, 160) : null,
      };
      if (suppressedBy) {
        suppressed++;
        rows.push({ ...base, status: 'SUPPRESSED', errorMessage: suppressedBy });
      } else if (channel === 'IN_APP') {
        rows.push({ ...base, status: 'SENT', sentAt: new Date() });
        inApp.push({ userId: u.id, row: base });
      } else {
        rows.push({ ...base, status: 'QUEUED' });
        deliver.push(id);
      }
    }
  }
  // skipDuplicates + the partial unique index on dedupe_key = a retried job never sends twice.
  await repo.insertMany(systemScope, rows);
  for (const n of inApp) emitToRoom(`user:${n.userId}`, 'notification', { id: n.row.id, category, title: n.row.title, body: n.row.body, data: input.data ?? {} });
  if (deliver.length) enqueueDelivery(deliver, urgent ? 0 : quietDelayMs(p.quietHours));
  return { recipients: users.length, queued: rows.length - suppressed, suppressed };
}

/**
 * One-time links (vendor activation, password reset) are delivered synchronously and the
 * persisted row carries the body with the secret masked: an outbox payload or a queued job
 * would otherwise put the token at rest in Redis/Postgres (security.md §8.2).
 */
export async function sendSecretLink(input: { userId: string; templateCode: string; variables: Record<string, string>; secrets: Record<string, string> }): Promise<'SENT' | 'FAILED' | 'UNREACHABLE'> {
  const [u] = await repo.findRecipients(systemScope, [input.userId]);
  if (!u) return 'UNREACHABLE';
  const p = await policy();
  const defaultLocale = await getSettingValue<string>('notifications.default_locale', 'ar');
  const locale = u.preferredLocale === 'en' || u.preferredLocale === 'ar' ? u.preferredLocale : defaultLocale;
  const templates = await repo.findTemplates(systemScope, input.templateCode, locale);
  const masked = Object.fromEntries(Object.keys(input.secrets).map((k) => [k, '[link]']));
  const order: Channel[] = u.email ? ['EMAIL', 'SMS'] : ['SMS', 'EMAIL'];
  for (const channel of order) {
    const t = pickTemplate(templates, channel, locale);
    if (!t || !p.enabled.has(channel) || reachable(u, channel)) continue;
    const forDelivery = renderFor(t, { ...input.variables, ...input.secrets });
    const forStorage = renderFor(t, { ...input.variables, ...masked });
    const id = newId();
    let status: 'SENT' | 'FAILED' = 'SENT';
    let providerMessageId: string | null = null;
    let errorMessage: string | null = null;
    try {
      const res = channel === 'EMAIL'
        ? await emailProvider().send({ to: u.email ?? '', subject: forDelivery.title ?? t.code, text: forDelivery.body, locale: locale as 'ar' | 'en' })
        : await smsProvider().send({ to: u.phoneE164 ?? '', text: forDelivery.body, senderId: p.smsSenderId });
      providerMessageId = res.providerMessageId;
    } catch (err) {
      status = 'FAILED';
      errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      logger().error({ err, templateCode: t.code, channel }, 'secret-link delivery failed');
    }
    await repo.insertMany(systemScope, [{ id, userId: u.id, templateCode: t.code, channel, category: t.category, title: forStorage.title, body: forStorage.body, data: {}, status, providerMessageId, errorMessage, ...(status === 'SENT' ? { sentAt: new Date() } : {}) }]);
    return status;
  }
  return 'UNREACHABLE';
}

// ── delivery worker ──────────────────────────────────────────────────────────

/** Deliver QUEUED rows through the channel providers. Returns the ids that failed (the caller decides whether to retry or finalise). */
export async function deliver(ids: string[] | null, opts: { finalAttempt: boolean; limit?: number }): Promise<{ sent: number; failed: string[]; suppressed: number }> {
  const rows = await repo.findQueued(systemScope, ids, opts.limit ?? 200);
  if (!rows.length) return { sent: 0, failed: [], suppressed: 0 };
  const p = await policy();
  const users = new Map((await repo.findRecipients(systemScope, [...new Set(rows.map((r) => r.userId))])).map((u) => [u.id, u]));
  let sent = 0;
  let suppressed = 0;
  const failed: string[] = [];
  for (const r of rows) {
    const u = users.get(r.userId);
    const channel = r.channel as Channel;
    const why = !u ? 'recipient missing' : !p.enabled.has(channel) ? 'channel disabled' : reachable(u, channel);
    if (why || !u) {
      await repo.markDelivery(systemScope, r.id, { status: 'SUPPRESSED', errorMessage: why ?? 'recipient missing' });
      suppressed++;
      continue;
    }
    const locale: 'ar' | 'en' = u.preferredLocale === 'en' ? 'en' : 'ar';
    try {
      if (channel === 'EMAIL') {
        const res = await emailProvider().send({ to: u.email ?? '', subject: r.title ?? r.templateCode, text: r.body, locale });
        await repo.markDelivery(systemScope, r.id, { status: 'SENT', providerMessageId: res.providerMessageId });
      } else if (channel === 'SMS') {
        const res = await smsProvider().send({ to: u.phoneE164 ?? '', text: r.body, senderId: p.smsSenderId });
        await repo.markDelivery(systemScope, r.id, { status: 'SENT', providerMessageId: res.providerMessageId });
      } else if (channel === 'PUSH') {
        const data = typeof r.data === 'object' && r.data !== null && !Array.isArray(r.data) ? Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])) : {};
        const res = await pushProvider().send({ tokens: u.deviceTokens.map((d) => d.token), title: r.title ?? '', body: r.body, data: { ...data, notificationId: r.id, category: r.category } });
        await repo.deactivateDeviceTokens(systemScope, res.invalidTokens);
        await repo.markDelivery(systemScope, r.id, { status: 'SENT', providerMessageId: res.providerMessageId });
      }
      sent++;
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      logger().warn({ err, notificationId: r.id, channel, finalAttempt: opts.finalAttempt }, 'notification delivery failed');
      if (opts.finalAttempt) await repo.markDelivery(systemScope, r.id, { status: 'FAILED', errorMessage: message });
      failed.push(r.id);
    }
  }
  return { sent, failed, suppressed };
}

/** Sweeper: rows still QUEUED after ten minutes (a lost enqueue) are delivered here; after an hour they are finalised. */
export async function deliverStale(): Promise<number> {
  const p = await policy();
  if (quietDelayMs(p.quietHours) > 0) return 0;
  const r = await deliver(null, { finalAttempt: false, limit: 500 });
  return r.sent;
}

export async function purgeNotifications(): Promise<number> {
  const days = await getSettingValue<number>('notifications.retention_days', 180);
  return repo.purgeOlderThan(systemScope, new Date(Date.now() - days * 86_400_000));
}

// ── inbox ────────────────────────────────────────────────────────────────────

export async function inbox(scope: ActorScope, q: z.infer<typeof listNotificationsQuery>): Promise<{ items: NotificationDto[]; nextCursor: string | null }> {
  const { items, nextCursor } = await repo.listInbox(scope, q);
  return { items: items.map(toNotificationDto), nextCursor };
}

export async function unreadCount(scope: ActorScope): Promise<NotificationUnreadCountDto> {
  return repo.unreadCount(scope);
}

export async function markRead(scope: ActorScope, id: string): Promise<NotificationDto> {
  const r = await repo.markRead(scope, id);
  if (!r) throw new NotFoundError();
  return toNotificationDto(r);
}

export async function markAllRead(scope: ActorScope, category: string | undefined): Promise<{ updated: number }> {
  return { updated: await repo.markAllRead(scope, category) };
}

export async function remove(scope: ActorScope, id: string): Promise<void> {
  if (!(await repo.deleteOwn(scope, id))) throw new NotFoundError();
}

// ── preferences ──────────────────────────────────────────────────────────────

export async function preferences(scope: ActorScope): Promise<NotificationPreferenceDto[]> {
  const [stored, codes, p] = await Promise.all([repo.listPreferences(scope), repo.templateCodes(scope), policy()]);
  const categories = [...new Set(codes.map((c) => c.category))].filter((c) => c !== 'OPERATIONS').sort();
  const out: NotificationPreferenceDto[] = [];
  for (const category of categories) {
    for (const channel of CHANNELS) {
      const s = stored.find((x) => x.category === category && x.channel === channel);
      out.push({ category, channel, isEnabled: p.locked.has(category) ? true : (s?.isEnabled ?? true), isLocked: p.locked.has(category) });
    }
  }
  return out;
}

export async function setPreferences(scope: ActorScope, body: z.infer<typeof putNotificationPreferencesBody>): Promise<NotificationPreferenceDto[]> {
  const p = await policy();
  const locked = body.preferences.filter((x) => p.locked.has(x.category) && !x.isEnabled);
  if (locked.length) throw new BusinessRuleError('NOTIFICATION_CATEGORY_LOCKED', 'Transactional categories cannot be switched off', { categories: [...new Set(locked.map((x) => x.category))] });
  await repo.upsertPreferences(scope, body.preferences.filter((x) => !p.locked.has(x.category)));
  return preferences(scope);
}

export async function registerDevice(scope: ActorScope, body: z.infer<typeof registerDeviceTokenBody>): Promise<void> {
  await repo.upsertDeviceToken(scope, { id: newId(), token: body.token, platform: body.platform, appVersion: body.appVersion ?? null });
}

export async function unregisterDevice(scope: ActorScope, token: string): Promise<void> {
  await repo.removeDeviceToken(scope, token);
}

// ── ops send ─────────────────────────────────────────────────────────────────

export async function sendToAudience(scope: ActorScope, body: z.infer<typeof sendNotificationBody>): Promise<NotificationSendResultDto> {
  const templates = await repo.findTemplates(scope, body.templateCode, 'en');
  if (!templates.length) throw new NotFoundError('NOTIFICATION_TEMPLATE_NOT_FOUND', 'No active template with that code');
  const required = new Set(templates.flatMap((t) => [...t.variables, ...placeholdersIn(t.body), ...(t.subject ? placeholdersIn(t.subject) : [])]));
  const missing = [...required].filter((v) => body.variables[v] === undefined);
  if (missing.length) throw new BusinessRuleError('NOTIFICATION_TEMPLATE_VARIABLES_MISSING', 'The template needs variables that were not supplied', { missing });
  const userIds = await repo.resolveAudience(scope, body.audience);
  if (!userIds.length) throw new BusinessRuleError('NOTIFICATION_AUDIENCE_EMPTY', 'The audience filter matched nobody');
  const r = await notify({ userIds, templateCode: body.templateCode, variables: body.variables, channels: body.channels, urgent: body.urgent, data: body.data, dedupeKey: `ops:${scope.requestId}` });
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'notification.sent', entityType: 'notification_template', entityId: body.templateCode, severity: body.urgent ? 'NOTICE' : 'INFO', afterValue: { audience: body.audience, channels: body.channels ?? 'all', urgent: body.urgent, recipients: r.recipients, queued: r.queued, suppressed: r.suppressed } });
  return { templateCode: body.templateCode, recipients: r.recipients, queued: r.queued, suppressed: r.suppressed };
}

// ── templates ────────────────────────────────────────────────────────────────

export async function listTemplates(scope: ActorScope, q: z.infer<typeof listNotificationTemplatesQuery>): Promise<{ items: NotificationTemplateDto[]; total: number }> {
  const { items, total } = await repo.listTemplates(scope, q, q);
  return { items: items.map(toTemplateDto), total };
}

export async function getTemplate(scope: ActorScope, id: string): Promise<NotificationTemplateDto> {
  const t = await repo.findTemplate(scope, id);
  if (!t) throw new NotFoundError();
  return toTemplateDto(t);
}

export async function createTemplate(scope: ActorScope, body: z.infer<typeof createNotificationTemplateBody>): Promise<NotificationTemplateDto> {
  const existing = await repo.listTemplates(scope, { code: body.code, channel: body.channel, locale: body.locale }, { page: 1, pageSize: 1 });
  if (existing.total) throw new ConflictError('CONFLICT', 'A template with that code, channel and locale already exists', { id: existing.items[0]?.id });
  const t = await repo.createTemplate(scope, { id: newId(), code: body.code, channel: body.channel, locale: body.locale, subject: body.subject ?? null, body: body.body, variables: body.variables, category: body.category, isActive: body.isActive });
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'notification_template.created', entityType: 'notification_template', entityId: t.id, afterValue: { code: t.code, channel: t.channel, locale: t.locale } });
  return toTemplateDto(t);
}

export async function patchTemplate(scope: ActorScope, id: string, body: z.infer<typeof patchNotificationTemplateBody>): Promise<NotificationTemplateDto> {
  const before = await repo.findTemplate(scope, id);
  if (!before) throw new NotFoundError();
  const t = await repo.updateTemplate(scope, id, {
    ...(body.subject !== undefined ? { subject: body.subject } : {}), ...(body.body !== undefined ? { body: body.body } : {}), ...(body.variables !== undefined ? { variables: body.variables } : {}),
    ...(body.category !== undefined ? { category: body.category } : {}), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
  });
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'notification_template.updated', entityType: 'notification_template', entityId: id, beforeValue: { subject: before.subject, body: before.body, isActive: before.isActive, version: before.version }, afterValue: { subject: t.subject, body: t.body, isActive: t.isActive, version: t.version }, changedFields: Object.keys(body) });
  return toTemplateDto(t);
}

export async function previewTemplate(scope: ActorScope, id: string, variables: Record<string, string>): Promise<NotificationPreviewDto> {
  const t = await repo.findTemplate(scope, id);
  if (!t) throw new NotFoundError();
  const r = renderFor(t, variables);
  return { locale: t.locale, channel: t.channel, subject: r.title, body: r.body, missingVariables: r.missing };
}
