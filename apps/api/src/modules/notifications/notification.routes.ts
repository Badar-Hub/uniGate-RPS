import { Router, type Request } from 'express';
import type { z } from 'zod';
import { createNotificationTemplateBody, idParams, listNotificationTemplatesQuery, listNotificationsQuery, patchNotificationTemplateBody, previewNotificationTemplateBody, putNotificationPreferencesBody, readAllNotificationsBody, registerDeviceTokenBody, sendNotificationBody } from '@unigate/validation';
import { ok, paginated, sendNoContent, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor, selfScope } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as n from './notification.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/** api.md §8.26 `/notifications`. The inbox and preferences are SELF; send and templates are GLOBAL. */
export function notificationsRouter(): Router {
  const r = Router({ strict: true });
  r.use('/notifications', authenticate(), csrfGuard());
  const self = (req: Request) => selfScope(req);
  const global = (req: Request) => scopeFor(req, 'notifications.send');

  r.get('/notifications', requirePermission('notifications.read'), validate({ query: listNotificationsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listNotificationsQuery>>).validated;
    const { items, nextCursor } = await n.inbox(self(req), query);
    res.status(200).json(ok(items, { nextCursor }));
  }));
  r.get('/notifications/unread-count', requirePermission('notifications.read'), h(async (req, res) => {
    sendOk(res, await n.unreadCount(self(req)));
  }));
  r.post('/notifications/read-all', requirePermission('notifications.read'), validate({ body: readAllNotificationsBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof readAllNotificationsBody>>).validated;
    sendOk(res, await n.markAllRead(self(req), body.category));
  }));
  r.get('/notifications/preferences', requirePermission('notifications.read'), h(async (req, res) => {
    sendOk(res, await n.preferences(self(req)));
  }));
  r.put('/notifications/preferences', requirePermission('notifications.read'), validate({ body: putNotificationPreferencesBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof putNotificationPreferencesBody>>).validated;
    sendOk(res, await n.setPreferences(self(req), body));
  }));
  r.post('/notifications/devices', requirePermission('notifications.read'), validate({ body: registerDeviceTokenBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof registerDeviceTokenBody>>).validated;
    await n.registerDevice(self(req), body);
    sendNoContent(res);
  }));
  r.delete('/notifications/devices/:token', requirePermission('notifications.read'), h(async (req, res) => {
    await n.unregisterDevice(self(req), String(req.params['token']));
    sendNoContent(res);
  }));
  r.post('/notifications/send', requirePermission('notifications.send'), idempotent({ required: true }), validate({ body: sendNotificationBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof sendNotificationBody>>).validated;
    res.status(202).json(ok(await n.sendToAudience(global(req), body)));
  }));
  r.get('/notifications/templates', requirePermission('notifications.templates.manage'), validate({ query: listNotificationTemplatesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listNotificationTemplatesQuery>>).validated;
    const { items, total } = await n.listTemplates(global(req), query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/notifications/templates', requirePermission('notifications.templates.manage'), validate({ body: createNotificationTemplateBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createNotificationTemplateBody>>).validated;
    res.status(201).json(ok(await n.createTemplate(global(req), body)));
  }));
  r.get('/notifications/templates/:id', requirePermission('notifications.templates.manage'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await n.getTemplate(global(req), params.id));
  }));
  r.patch('/notifications/templates/:id', requirePermission('notifications.templates.manage'), validate({ params: idParams, body: patchNotificationTemplateBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchNotificationTemplateBody>, unknown, Id>).validated;
    sendOk(res, await n.patchTemplate(global(req), params.id, body));
  }));
  r.post('/notifications/templates/:id/preview', requirePermission('notifications.templates.manage'), validate({ params: idParams, body: previewNotificationTemplateBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof previewNotificationTemplateBody>, unknown, Id>).validated;
    sendOk(res, await n.previewTemplate(global(req), params.id, body.variables));
  }));
  r.post('/notifications/:id/read', requirePermission('notifications.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await n.markRead(self(req), params.id));
  }));
  r.delete('/notifications/:id', requirePermission('notifications.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    await n.remove(self(req), params.id);
    sendNoContent(res);
  }));

  return r;
}
