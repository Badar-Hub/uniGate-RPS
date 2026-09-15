import { Router, type Request, type Response } from 'express';
import type { z } from 'zod';
import {
  assignDriverBody,
  assignmentParams,
  calendarBlockBody,
  calendarEntryParams,
  calendarWindowQuery,
  createVehicleBody,
  idParams,
  listVehiclesQuery,
  patchVehicleBody,
  unassignDriverBody,
  vehicleDecisionBody,
  vehicleRejectBody,
  vehicleSuspendBody,
} from '@unigate/validation';
import { paginated, sendCreated, sendNoContent, sendOk } from '@/common/envelope.js';
import { h } from '@/common/handler.js';
import { authenticate, requirePermission, requirePermissionOrProfile, scopeFor } from '@/middleware/authenticate.js';
import { csrfGuard } from '@/middleware/csrf.js';
import { idempotent } from '@/middleware/idempotency.js';
import { validate, type ValidatedRequest } from '@/middleware/validate.js';
import * as fleet from './vehicle.service.js';

type R<B = unknown, Q = unknown, P = unknown> = ValidatedRequest<B, Q, P>;
type Id = z.infer<typeof idParams>;

/**
 * api.md §8.8 `/vehicles`. Owners hold vehicles.* for their own fleet (OWN scope); staff open
 * GLOBAL through vehicles.read_any / approve / suspend. Every id lookup goes through the
 * repository's scope predicate, so a foreign vehicle is 404.
 */
export function fleetRouter(): Router {
  const r = Router({ strict: true });
  // Path-scoped on purpose: a bare router.use() would run for EVERY request passing through the
  // router, including public routes mounted later (settings/public, reference catalogue).
  r.use('/vehicles', authenticate(), csrfGuard());

  r.get('/vehicles', requirePermissionOrProfile('vehicles.read', 'owner'), validate({ query: listVehiclesQuery }), h(async (req: Request, res: Response) => {
    const { query } = (req as R<unknown, z.infer<typeof listVehiclesQuery>>).validated;
    const { items, total } = await fleet.listVehicles(scopeFor(req, 'vehicles.read_any'), query, query);
    res.status(200).json(paginated(items, query.page, query.pageSize, total));
  }));
  r.post('/vehicles', requirePermission('vehicles.create'), idempotent({ required: false }), validate({ body: createVehicleBody }), h(async (req, res) => {
    const { body } = (req as R<z.infer<typeof createVehicleBody>>).validated;
    const dto = await fleet.createVehicle(scopeFor(req, 'vehicles.read_any'), body);
    sendCreated(res, dto, `/api/v1/vehicles/${dto.id}`);
  }));
  r.get('/vehicles/:id', requirePermissionOrProfile('vehicles.read', 'owner'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await fleet.getVehicle(scopeFor(req, 'vehicles.read_any'), params.id));
  }));
  r.patch('/vehicles/:id', requirePermission('vehicles.update'), validate({ params: idParams, body: patchVehicleBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof patchVehicleBody>, unknown, Id>).validated;
    sendOk(res, await fleet.patchVehicle(scopeFor(req, 'vehicles.read_any'), params.id, body));
  }));
  r.delete('/vehicles/:id', requirePermission('vehicles.delete'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    await fleet.deleteVehicle(scopeFor(req, 'vehicles.read_any'), params.id);
    sendNoContent(res);
  }));
  r.post('/vehicles/:id/submit-for-approval', requirePermission('vehicles.update'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await fleet.submitForApproval(scopeFor(req, 'vehicles.read_any'), params.id));
  }));
  r.post('/vehicles/:id/approve', requirePermission('vehicles.approve'), validate({ params: idParams, body: vehicleDecisionBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof vehicleDecisionBody>, unknown, Id>).validated;
    sendOk(res, await fleet.approveVehicle(scopeFor(req, 'vehicles.approve'), params.id, body.notes));
  }));
  r.post('/vehicles/:id/reject', requirePermission('vehicles.approve'), validate({ params: idParams, body: vehicleRejectBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof vehicleRejectBody>, unknown, Id>).validated;
    sendOk(res, await fleet.rejectVehicle(scopeFor(req, 'vehicles.approve'), params.id, body.rejectionReason));
  }));
  r.post('/vehicles/:id/suspend', requirePermission('vehicles.suspend'), validate({ params: idParams, body: vehicleSuspendBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof vehicleSuspendBody>, unknown, Id>).validated;
    sendOk(res, await fleet.suspendVehicle(scopeFor(req, 'vehicles.suspend'), params.id, body.reason));
  }));
  r.post('/vehicles/:id/reactivate', requirePermission('vehicles.suspend'), validate({ params: idParams, body: vehicleDecisionBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof vehicleDecisionBody>, unknown, Id>).validated;
    sendOk(res, await fleet.reactivateVehicle(scopeFor(req, 'vehicles.suspend'), params.id, body.notes));
  }));

  // ── calendar & availability ────────────────────────────────────────────────
  r.get('/vehicles/:id/calendar', requirePermissionOrProfile('vehicles.read', 'owner'), validate({ params: idParams, query: calendarWindowQuery }), h(async (req, res) => {
    const { params, query } = (req as R<unknown, z.infer<typeof calendarWindowQuery>, Id>).validated;
    sendOk(res, await fleet.listCalendar(scopeFor(req, 'vehicles.read_any'), params.id, new Date(query.from), new Date(query.to)));
  }));
  r.post('/vehicles/:id/calendar/blocks', requirePermission('vehicles.availability.manage'), validate({ params: idParams, body: calendarBlockBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof calendarBlockBody>, unknown, Id>).validated;
    sendCreated(res, await fleet.addOwnerBlock(scopeFor(req, 'vehicles.read_any'), params.id, body));
  }));
  r.delete('/vehicles/:id/calendar/blocks/:entryId', requirePermission('vehicles.availability.manage'), validate({ params: calendarEntryParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, z.infer<typeof calendarEntryParams>>).validated;
    await fleet.releaseOwnerBlock(scopeFor(req, 'vehicles.read_any'), params.id, params.entryId);
    sendNoContent(res);
  }));
  r.get('/vehicles/:id/availability', requirePermissionOrProfile('vehicles.read', 'owner'), validate({ params: idParams, query: calendarWindowQuery }), h(async (req, res) => {
    const { params, query } = (req as R<unknown, z.infer<typeof calendarWindowQuery>, Id>).validated;
    sendOk(res, await fleet.availability(scopeFor(req, 'vehicles.read_any'), params.id, new Date(query.from), new Date(query.to)));
  }));

  // ── driver assignments ─────────────────────────────────────────────────────
  r.get('/vehicles/:id/drivers', requirePermissionOrProfile('vehicles.read', 'owner'), validate({ params: idParams }), h(async (req, res) => {
    const { params } = (req as R<unknown, unknown, Id>).validated;
    sendOk(res, await fleet.listAssignments(scopeFor(req, 'vehicles.read_any'), params.id));
  }));
  r.post('/vehicles/:id/drivers', requirePermission('drivers.assign'), validate({ params: idParams, body: assignDriverBody }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof assignDriverBody>, unknown, Id>).validated;
    sendCreated(res, await fleet.assignDriver(scopeFor(req, 'vehicles.read_any'), params.id, body.driverProfileId, body.isPrimary));
  }));
  r.delete('/vehicles/:id/drivers/:assignmentId', requirePermission('drivers.assign'), validate({ params: assignmentParams, body: unassignDriverBody.optional() }), h(async (req, res) => {
    const { params, body } = (req as R<z.infer<typeof unassignDriverBody> | undefined, unknown, z.infer<typeof assignmentParams>>).validated;
    await fleet.unassignDriver(scopeFor(req, 'vehicles.read_any'), params.id, params.assignmentId, body?.reason);
    sendNoContent(res);
  }));

  return r;
}
