import { z } from 'zod';
import { NOTIFICATION_CHANNEL } from '@unigate/types';
import { locale, safeText, uuid } from './primitives.js';
import { cursorPagination, offsetPagination } from './pagination.js';

/** Notifications (api.md §8.26). */

const category = z.string().regex(/^[A-Z_]{2,48}$/, 'category codes are UPPER_SNAKE');
const templateCode = z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/, 'template codes are UPPER_SNAKE');
/** Variable values are plain strings — the renderer never interprets them. */
const variables = z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,47}$/), z.string().max(2000)).default({});

export const listNotificationsQuery = cursorPagination.extend({ category: category.optional(), unreadOnly: z.coerce.boolean().default(false), channel: z.enum(NOTIFICATION_CHANNEL).optional() }).strict();
export const readAllNotificationsBody = z.object({ category: category.optional() }).strict();

export const notificationPreferenceItem = z.object({ category, channel: z.enum(NOTIFICATION_CHANNEL), isEnabled: z.boolean() }).strict();
export const putNotificationPreferencesBody = z.object({ preferences: z.array(notificationPreferenceItem).min(1).max(200) }).strict();

/** Ops broadcast / targeted send: a template + variables to an audience, never free text. */
export const sendNotificationBody = z
  .object({
    templateCode,
    variables,
    channels: z.array(z.enum(NOTIFICATION_CHANNEL)).min(1).max(4).optional(),
    audience: z
      .object({
        userIds: z.array(uuid).max(500).optional(),
        roleCodes: z.array(z.string().regex(/^[A-Z_]{2,48}$/)).max(20).optional(),
        profileTypes: z.array(z.enum(['CUSTOMER', 'OWNER', 'DRIVER', 'SPO'])).max(4).optional(),
      })
      .strict()
      .refine((a) => Boolean(a.userIds?.length) || Boolean(a.roleCodes?.length) || Boolean(a.profileTypes?.length), 'audience must name userIds, roleCodes or profileTypes'),
    /** Ignore quiet hours and preferences (operational emergencies only; audited). */
    urgent: z.boolean().default(false),
    data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

export const listNotificationTemplatesQuery = offsetPagination.extend({ code: templateCode.optional(), channel: z.enum(NOTIFICATION_CHANNEL).optional(), locale: locale.optional(), category: category.optional(), isActive: z.coerce.boolean().optional() }).strict();
export const createNotificationTemplateBody = z
  .object({
    code: templateCode,
    channel: z.enum(NOTIFICATION_CHANNEL),
    locale,
    subject: safeText(200).nullable().optional(),
    body: z.string().min(1).max(4000),
    variables: z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,47}$/)).max(40).default([]),
    category,
    isActive: z.boolean().default(true),
  })
  .strict();
export const patchNotificationTemplateBody = createNotificationTemplateBody.omit({ code: true, channel: true, locale: true }).partial().strict();
export const previewNotificationTemplateBody = z.object({ variables }).strict();

/** Device tokens for push (stored even before a push provider is configured). */
export const registerDeviceTokenBody = z.object({ token: z.string().min(16).max(512), platform: z.enum(['IOS', 'ANDROID', 'WEB']), appVersion: safeText(32).optional() }).strict();
