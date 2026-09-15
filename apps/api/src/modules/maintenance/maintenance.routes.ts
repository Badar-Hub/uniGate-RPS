import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import { cancelMaintenanceRecordBody, completeMaintenanceRecordBody, createMaintenanceRecordBody, createMaintenanceScheduleBody, idParams, listMaintenanceRecordsQuery, listMaintenanceSchedulesQuery, maintenanceDueQuery, patchMaintenanceRecordBody, patchMaintenanceScheduleBody } from '@unigate/validation';
import { ok, paginated, sendNoContent, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as m from './maintenance.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/** api.md §8.23 `/maintenance`. Owners work on their own vehicles (OWN); `maintenance.read_any` opens GLOBAL for staff. */
export function maintenanceRouter(): Router {
  const r = Router({ strict: true });
  r.use('/maintenance', authenticate(), csrfGuard());
  const readScope = (req: Request) => scopeFor(req, 'maintenance.read_any', 'OWN');
  const page = (res: Response, items: unknown[], q: { page: number; pageSize: number }, total: number) => res.status(200).json(paginated(items, q.page, q.pageSize, total));

  r.get('/maintenance/records', requirePermission('maintenance.read'), validate({ query: listMaintenanceRecordsQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listMaintenanceRecordsQuery>>).validated;
    const { items, total } = await m.listRecords(readScope(req), query, query);
    page(res, items, query, total);
  }));
  r.post('/maintenance/records', requirePermission('maintenance.create'), idempotent({ required: false }), validate({ body: createMaintenanceRecordBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createMaintenanceRecordBody>>).validated;
    const dto = await m.createRecord(readScope(req), body);
    res.setHeader('Location', `/api/v1/maintenance/records/${dto.id}`);
    res.status(201).json(ok(dto));
  }));
  r.get('/maintenance/due', requirePermission('maintenance.read'), validate({ query: maintenanceDueQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof maintenanceDueQuery>>).validated;
    sendOk(res, await m.listDue(readScope(req), query));
  }));
  r.get('/maintenance/schedules', requirePermission('maintenance.read'), validate({ query: listMaintenanceSchedulesQuery }), h(async (req, res) => {
    const { query } = (req as R<unknown, z.infer<typeof listMaintenanceSchedulesQuery>>).validated;
    const { items, total } = await m.listSchedules(readScope(req), query, query);
    page(res, items, query, total);
  }));
  r.post('/maintenance/schedules', requirePermission('maintenance.create'), validate({ body: createMaintenanceScheduleBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createMaintenanceScheduleBody>>).validated;
    res.status(201).json(ok(await m.createSchedule(readScope(req), body)));
  }));
  r.patch('/maintenance/schedules/:id', requirePermission('maintenance.update'), validate({ params: idParams, body: patchMaintenanceScheduleBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchMaintenanceScheduleBody>, unknown, Id>).validated;
    sendOk(res, await m.patchSchedule(readScope(req), params.id, body));
  }));
  r.delete('/maintenance/schedules/:id', requirePermission('maintenance.delete'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    await m.deleteSchedule(readScope(req), params.id);
    sendNoContent(res);
  }));
  r.get('/maintenance/records/:id', requirePermission('maintenance.read'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await m.getRecord(readScope(req), params.id));
  }));
  r.patch('/maintenance/records/:id', requirePermission('maintenance.update'), validate({ params: idParams, body: patchMaintenanceRecordBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchMaintenanceRecordBody>, unknown, Id>).validated;
    sendOk(res, await m.patchRecord(readScope(req), params.id, body));
  }));
  r.post('/maintenance/records/:id/start', requirePermission('maintenance.update'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await m.startRecord(readScope(req), params.id));
  }));
  r.post('/maintenance/records/:id/complete', requirePermission('maintenance.update'), idempotent({ required: false }), validate({ params: idParams, body: completeMaintenanceRecordBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof completeMaintenanceRecordBody>, unknown, Id>).validated;
    sendOk(res, await m.completeRecord(readScope(req), params.id, body));
  }));
  r.post('/maintenance/records/:id/cancel', requirePermission('maintenance.update'), validate({ params: idParams, body: cancelMaintenanceRecordBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof cancelMaintenanceRecordBody>, unknown, Id>).validated;
    sendOk(res, await m.cancelRecord(readScope(req), params.id, body.reason));
  }));
  r.delete('/maintenance/records/:id', requirePermission('maintenance.delete', 'maintenance.read_any'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    await m.deleteRecord(scopeFor(req, 'maintenance.read_any'), params.id);
    sendNoContent(res);
  }));

  return r;
}
