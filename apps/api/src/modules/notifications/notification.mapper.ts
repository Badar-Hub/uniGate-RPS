import type { NotificationDto, NotificationTemplateDto } from '@unigate/types';
import type { NotificationRow, TemplateRow } from './notification.repository.js';

export function toNotificationDto(r: NotificationRow): NotificationDto {
  return {
    id: r.id, templateCode: r.templateCode, channel: r.channel, category: r.category, title: r.title, body: r.body,
    data: typeof r.data === 'object' && r.data !== null && !Array.isArray(r.data) ? r.data : {},
    status: r.status, readAt: r.readAt ? r.readAt.toISOString() : null, createdAt: r.createdAt.toISOString(),
  };
}

export function toTemplateDto(t: TemplateRow): NotificationTemplateDto {
  return { id: t.id, code: t.code, channel: t.channel, locale: t.locale, subject: t.subject, body: t.body, variables: t.variables, category: t.category, isActive: t.isActive, version: t.version, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}
