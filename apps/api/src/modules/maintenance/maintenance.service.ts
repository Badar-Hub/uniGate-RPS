import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, MaintenanceDueDto, MaintenanceRecordDto, MaintenanceScheduleDto } from '@unigate/types';
import type { completeMaintenanceRecordBody, createMaintenanceRecordBody, createMaintenanceScheduleBody, maintenanceDueQuery, patchMaintenanceRecordBody, patchMaintenanceScheduleBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money, round2 } from '@/common/money.js';
import { isExclusionViolation, prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { createExpense } from '@/modules/finance/expense.service.js';
import { getVehicle, listCalendar, setOperationalStatus, updateOdometer } from '@/modules/fleet/vehicle.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { toDueDto, toRecordDto, toScheduleDto } from './maintenance.mapper.js';
import * as repo from './maintenance.repository.js';

/**
 * Maintenance (api.md §8.23, BRIEF-§21). A PLANNED / IN_PROGRESS record holds a MAINTENANCE entry
 * on the vehicle's calendar in the same transaction, so a vehicle in the workshop is unbookable
 * structurally (the EXCLUDE constraint decides; a clash is 409 naming the blocking booking).
 * Completion releases the hold, moves the odometer, returns the vehicle to service, rolls the
 * matching schedule forward and books the cost as a MAINTENANCE expense of the owner.
 */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}
const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'maintenance', requestId: 'internal' };

// ── reads ────────────────────────────────────────────────────────────────────

export async function getRecord(scope: AnyScope, id: string): Promise<MaintenanceRecordDto> {
  const r = await repo.findRecord(scope, id);
  if (!r) throw new NotFoundError();
  return toRecordDto(r);
}

export async function listRecords(scope: AnyScope, f: repo.RecordFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listRecords(scope, f, page);
  return { items: items.map(toRecordDto), total };
}

// ── records ──────────────────────────────────────────────────────────────────

/** The vehicle must be one the actor may manage (owners: their own; staff: any). */
async function vehicleFor(scope: ActorScope, vehicleId: string): Promise<{ id: string; ownerProfileId: string }> {
  const v = await getVehicle(scope, vehicleId);
  if (scope.kind !== 'GLOBAL' && v.ownerProfileId !== scope.actor.ownerProfileId) throw new NotFoundError();
  return { id: v.id, ownerProfileId: v.ownerProfileId };
}

async function holdOr409(scope: ActorScope, input: { vehicleId: string; recordId: string; from: Date; to: Date; notes: string | null }, tx: Prisma.TransactionClient): Promise<string> {
  const entryId = newId();
  try {
    await repo.insertCalendarHold(scope, { id: entryId, vehicleId: input.vehicleId, recordId: input.recordId, from: input.from, to: input.to, createdByUserId: scope.actor.userId, notes: input.notes }, tx);
  } catch (e) {
    if (!isExclusionViolation(e)) throw e;
    const conflicts = await listCalendar(scope, input.vehicleId, input.from, input.to);
    throw new ConflictError('MAINTENANCE_CALENDAR_CONFLICT', 'The maintenance window overlaps a reservation or block on the vehicle', { conflicts: conflicts.map((c) => ({ entryId: c.id, entryType: c.entryType, period: c.period, bookingNumber: c.bookingNumber })) });
  }
  return entryId;
}

export async function createRecord(scope: ActorScope, body: z.infer<typeof createMaintenanceRecordBody>): Promise<MaintenanceRecordDto> {
  const v = await vehicleFor(scope, body.vehicleId);
  const serviceType = await prisma().maintenanceServiceType.findFirst({ where: { id: body.maintenanceServiceTypeId, isActive: true }, select: { id: true } });
  if (!serviceType) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or inactive service type', { fieldErrors: { maintenanceServiceTypeId: ['unknown or inactive'] }, formErrors: [] });
  const currency = await getSettingValue<string>('finance.currency', 'SAR');
  const cost = round2(money(body.costAmount));
  const vat = round2(money(body.vatAmount));
  const from = new Date(body.scheduledStartAt);
  const to = new Date(body.scheduledEndAt);
  const id = newId();
  // The record and its calendar hold are one transaction: a clash rolls both back (BRIEF-§21).
  await prisma().$transaction(async (tx) => {
    await tx.maintenanceRecord.create({
      data: {
        id, vehicleId: v.id, maintenanceServiceTypeId: body.maintenanceServiceTypeId, maintenanceKind: body.maintenanceKind, status: body.status, scheduledStartAt: from, scheduledEndAt: to, ...(body.status === 'IN_PROGRESS' ? { actualStartAt: new Date() } : {}),
        odometerKm: body.odometerKm ?? null, costAmount: cost, vatAmount: vat, totalAmount: cost.add(vat), currency, workshopName: body.workshopName ?? null, workshopContact: body.workshopContact ?? null, description: body.description ?? null,
        partsReplaced: body.partsReplaced, nextServiceDate: body.nextServiceDate ? new Date(`${body.nextServiceDate}T00:00:00.000Z`) : null, nextServiceOdometerKm: body.nextServiceOdometerKm ?? null, createdByUserId: scope.actor.userId,
        ...(body.documentIds.length ? { documents: { connect: body.documentIds.map((d) => ({ id: d })) } } : {}),
      },
    });
    await holdOr409(scope, { vehicleId: v.id, recordId: id, from, to, notes: body.workshopName ? `Maintenance — ${body.workshopName}` : 'Maintenance' }, tx);
    if (body.status === 'IN_PROGRESS') await setOperationalStatus(v.id, 'UNDER_MAINTENANCE', tx);
    await writeAudit({ ...audit(scope), action: 'maintenance.created', entityType: 'maintenance_record', entityId: id, afterValue: { vehicleId: v.id, kind: body.maintenanceKind, status: body.status, window: { from: from.toISOString(), to: to.toISOString() }, totalAmount: cost.add(vat).toFixed(2) } }, tx);
    await publishEvent('maintenance', id, 'maintenance.created', { vehicleId: v.id, ownerProfileId: v.ownerProfileId, status: body.status, from: from.toISOString(), to: to.toISOString() }, tx);
  });
  return getRecord(scope, id);
}

async function loadLocked(scope: ActorScope, id: string, tx: Prisma.TransactionClient): Promise<repo.RecordRow> {
  await repo.lockRecord(scope, id, tx);
  const r = await repo.findRecord(scope, id, tx);
  if (!r) throw new NotFoundError();
  return r;
}

const OPEN: repo.RecordRow['status'][] = ['PLANNED', 'IN_PROGRESS'];
function assertOpen(r: repo.RecordRow, to: string): void {
  if (!OPEN.includes(r.status)) throw new BusinessRuleError('MAINTENANCE_INVALID_TRANSITION', `A ${r.status} record cannot move to ${to}`, { from: r.status, to });
}

export async function patchRecord(scope: ActorScope, id: string, body: z.infer<typeof patchMaintenanceRecordBody>): Promise<MaintenanceRecordDto> {
  await prisma().$transaction(async (tx) => {
    const r = await loadLocked(scope, id, tx);
    assertOpen(r, 'update');
    if (body.maintenanceServiceTypeId) {
      const st = await tx.maintenanceServiceType.findFirst({ where: { id: body.maintenanceServiceTypeId, isActive: true }, select: { id: true } });
      if (!st) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or inactive service type', { fieldErrors: { maintenanceServiceTypeId: ['unknown or inactive'] }, formErrors: [] });
    }
    const cost = body.costAmount !== undefined ? round2(money(body.costAmount)) : r.costAmount;
    const vat = body.vatAmount !== undefined ? round2(money(body.vatAmount)) : r.vatAmount;
    const from = body.scheduledStartAt ? new Date(body.scheduledStartAt) : r.scheduledStartAt;
    const to = body.scheduledEndAt ? new Date(body.scheduledEndAt) : r.scheduledEndAt;
    if (to <= from) throw new BusinessRuleError('VALIDATION_FAILED', 'scheduledEndAt must be after scheduledStartAt', { fieldErrors: { scheduledEndAt: ['must be after scheduledStartAt'] }, formErrors: [] });
    await tx.maintenanceRecord.update({
      where: { id },
      data: {
        ...(body.maintenanceServiceTypeId ? { maintenanceServiceTypeId: body.maintenanceServiceTypeId } : {}), ...(body.maintenanceKind ? { maintenanceKind: body.maintenanceKind } : {}), scheduledStartAt: from, scheduledEndAt: to,
        ...(body.odometerKm !== undefined ? { odometerKm: body.odometerKm } : {}), costAmount: cost, vatAmount: vat, totalAmount: cost.add(vat),
        ...(body.workshopName !== undefined ? { workshopName: body.workshopName } : {}), ...(body.workshopContact !== undefined ? { workshopContact: body.workshopContact } : {}), ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.partsReplaced ? { partsReplaced: body.partsReplaced } : {}), ...(body.nextServiceDate !== undefined ? { nextServiceDate: body.nextServiceDate ? new Date(`${body.nextServiceDate}T00:00:00.000Z`) : null } : {}),
        ...(body.nextServiceOdometerKm !== undefined ? { nextServiceOdometerKm: body.nextServiceOdometerKm } : {}),
      },
    });
    // A moved window re-attempts the hold — and can 409 like creation.
    if (from.getTime() !== r.scheduledStartAt.getTime() || to.getTime() !== r.scheduledEndAt.getTime()) {
      await repo.releaseCalendarHold(scope, id, tx);
      await holdOr409(scope, { vehicleId: r.vehicleId, recordId: id, from, to, notes: 'Maintenance' }, tx);
    }
    await writeAudit({ ...audit(scope), action: 'maintenance.updated', entityType: 'maintenance_record', entityId: id, beforeValue: { window: { from: r.scheduledStartAt.toISOString(), to: r.scheduledEndAt.toISOString() }, totalAmount: r.totalAmount.toFixed(2) }, afterValue: { ...body }, changedFields: Object.keys(body) }, tx);
  });
  return getRecord(scope, id);
}

/** PLANNED → IN_PROGRESS: the vehicle goes UNDER_MAINTENANCE now. */
export async function startRecord(scope: ActorScope, id: string): Promise<MaintenanceRecordDto> {
  await prisma().$transaction(async (tx) => {
    const r = await loadLocked(scope, id, tx);
    if (r.status !== 'PLANNED') throw new BusinessRuleError('MAINTENANCE_INVALID_TRANSITION', `A ${r.status} record cannot be started`, { from: r.status, to: 'IN_PROGRESS' });
    await tx.maintenanceRecord.update({ where: { id }, data: { status: 'IN_PROGRESS', actualStartAt: new Date() } });
    await setOperationalStatus(r.vehicleId, 'UNDER_MAINTENANCE', tx);
    await writeAudit({ ...audit(scope), action: 'maintenance.started', entityType: 'maintenance_record', entityId: id, beforeValue: { status: r.status }, afterValue: { status: 'IN_PROGRESS' } }, tx);
  });
  return getRecord(scope, id);
}

/**
 * → COMPLETED: actual end, odometer forward, calendar hold released, vehicle back to IDLE, the
 * matching schedule rolled forward from the actual service, and the cost booked as an expense.
 */
export async function completeRecord(scope: ActorScope, id: string, body: z.infer<typeof completeMaintenanceRecordBody>): Promise<MaintenanceRecordDto> {
  const categoryId = (await prisma().expenseCategory.findFirst({ where: { code: 'MAINTENANCE', isActive: true }, select: { id: true } }))?.id ?? null;
  const done = await prisma().$transaction(async (tx) => {
    const r = await loadLocked(scope, id, tx);
    assertOpen(r, 'COMPLETED');
    const actualEndAt = body.actualEndAt ? new Date(body.actualEndAt) : new Date();
    const cost = body.costAmount !== undefined ? round2(money(body.costAmount)) : r.costAmount;
    const vat = body.vatAmount !== undefined ? round2(money(body.vatAmount)) : r.vatAmount;
    const odometer = body.odometerKm ?? r.odometerKm;
    if (odometer !== null && r.vehicle.odometerKm !== null && odometer < r.vehicle.odometerKm) throw new BusinessRuleError('VALIDATION_FAILED', 'The odometer only moves forward', { fieldErrors: { odometerKm: [`at least ${r.vehicle.odometerKm}`] }, formErrors: [] });
    await tx.maintenanceRecord.update({
      where: { id },
      data: {
        status: 'COMPLETED', actualStartAt: r.actualStartAt ?? r.scheduledStartAt, actualEndAt, odometerKm: odometer, costAmount: cost, vatAmount: vat, totalAmount: cost.add(vat),
        ...(body.partsReplaced ? { partsReplaced: body.partsReplaced } : {}), ...(body.nextServiceDate !== undefined ? { nextServiceDate: body.nextServiceDate ? new Date(`${body.nextServiceDate}T00:00:00.000Z`) : null } : {}),
        ...(body.nextServiceOdometerKm !== undefined ? { nextServiceOdometerKm: body.nextServiceOdometerKm } : {}), ...(body.notes ? { description: r.description ? `${r.description}\n${body.notes}` : body.notes } : {}),
      },
    });
    await repo.releaseCalendarHold(scope, id, tx);
    if (odometer !== null) await updateOdometer(r.vehicleId, odometer, tx);
    if (r.vehicle.operationalStatus === 'UNDER_MAINTENANCE') await setOperationalStatus(r.vehicleId, 'IDLE', tx);
    // Roll the schedule forward from the actual service, or from the record's explicit next-service thresholds.
    const schedule = await repo.scheduleFor(scope, r.vehicleId, r.maintenanceServiceTypeId, tx);
    if (schedule) {
      const nextDueAt = body.nextServiceDate ? new Date(`${body.nextServiceDate}T00:00:00.000Z`) : schedule.intervalDays ? new Date(actualEndAt.getTime() + schedule.intervalDays * 86_400_000) : null;
      const nextDueOdometerKm = body.nextServiceOdometerKm ?? (schedule.intervalKm && odometer !== null ? odometer + schedule.intervalKm : null);
      await tx.maintenanceSchedule.update({ where: { id: schedule.id }, data: { lastServiceAt: actualEndAt, lastServiceOdometerKm: odometer, nextDueAt, nextDueOdometerKm } });
    }
    await writeAudit({ ...audit(scope), action: 'maintenance.completed', entityType: 'maintenance_record', entityId: id, beforeValue: { status: r.status }, afterValue: { status: 'COMPLETED', actualEndAt: actualEndAt.toISOString(), odometerKm: odometer, totalAmount: cost.add(vat).toFixed(2), scheduleRolled: Boolean(schedule) } }, tx);
    await publishEvent('maintenance', id, 'maintenance.completed', { vehicleId: r.vehicleId, ownerProfileId: r.vehicle.ownerProfileId, totalAmount: cost.add(vat).toFixed(2) }, tx);
    return { ownerProfileId: r.vehicle.ownerProfileId, vehicleId: r.vehicleId, cost, vat, actualEndAt, description: `Maintenance ${r.serviceType.nameEn} (${r.vehicle.plateNumberEn})`, vendor: r.workshopName, odometer };
  });
  // The cost lands in the owner's expenses (vehicle profitability, BRIEF-§19) — after the record committed; a failure here never loses the completion.
  if (body.recordExpense && categoryId && done.cost.add(done.vat).gt(0)) {
    await createExpense(scope, {
      ownerProfileId: done.ownerProfileId, vehicleId: done.vehicleId, expenseCategoryId: categoryId, amount: done.cost.toFixed(2), vatAmount: done.vat.toFixed(2), expenseDate: done.actualEndAt.toISOString().slice(0, 10),
      description: done.description, ...(done.vendor ? { vendorName: done.vendor } : {}), ...(done.odometer !== null ? { odometerKm: done.odometer } : {}), isReimbursable: false,
    });
  }
  return getRecord(scope, id);
}

export async function cancelRecord(scope: ActorScope, id: string, reason: string): Promise<MaintenanceRecordDto> {
  await prisma().$transaction(async (tx) => {
    const r = await loadLocked(scope, id, tx);
    assertOpen(r, 'CANCELLED');
    await tx.maintenanceRecord.update({ where: { id }, data: { status: 'CANCELLED', description: r.description ? `${r.description}\nCancelled: ${reason}` : `Cancelled: ${reason}` } });
    await repo.releaseCalendarHold(scope, id, tx);
    if (r.vehicle.operationalStatus === 'UNDER_MAINTENANCE') await setOperationalStatus(r.vehicleId, 'IDLE', tx);
    await writeAudit({ ...audit(scope), action: 'maintenance.cancelled', entityType: 'maintenance_record', entityId: id, beforeValue: { status: r.status }, afterValue: { status: 'CANCELLED', reason } }, tx);
  });
  return getRecord(scope, id);
}

/** DELETE — a PLANNED record created in error (global). */
export async function deleteRecord(scope: ActorScope, id: string): Promise<void> {
  await prisma().$transaction(async (tx) => {
    const r = await loadLocked(scope, id, tx);
    if (r.status !== 'PLANNED') throw new BusinessRuleError('MAINTENANCE_INVALID_TRANSITION', 'Only a PLANNED record can be deleted; cancel or complete the others', { status: r.status });
    await repo.releaseCalendarHold(scope, id, tx);
    await tx.maintenanceRecord.delete({ where: { id } });
    await writeAudit({ ...audit(scope), action: 'maintenance.deleted', entityType: 'maintenance_record', entityId: id, beforeValue: { vehicleId: r.vehicleId, window: { from: r.scheduledStartAt.toISOString(), to: r.scheduledEndAt.toISOString() } } }, tx);
  });
}

// ── schedules ────────────────────────────────────────────────────────────────

function nextDue(s: { intervalDays: number | null; intervalKm: number | null; lastServiceAt: Date | null; lastServiceOdometerKm: number | null }): { nextDueAt: Date | null; nextDueOdometerKm: number | null } {
  return {
    nextDueAt: s.intervalDays && s.lastServiceAt ? new Date(s.lastServiceAt.getTime() + s.intervalDays * 86_400_000) : null,
    nextDueOdometerKm: s.intervalKm && s.lastServiceOdometerKm !== null ? s.lastServiceOdometerKm + s.intervalKm : null,
  };
}

export async function listSchedules(scope: AnyScope, f: Parameters<typeof repo.listSchedules>[1], page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listSchedules(scope, f, page);
  return { items: items.map(toScheduleDto), total };
}

export async function createSchedule(scope: ActorScope, body: z.infer<typeof createMaintenanceScheduleBody>): Promise<MaintenanceScheduleDto> {
  const v = await vehicleFor(scope, body.vehicleId);
  const serviceType = await prisma().maintenanceServiceType.findFirst({ where: { id: body.maintenanceServiceTypeId, isActive: true }, select: { id: true } });
  if (!serviceType) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or inactive service type', { fieldErrors: { maintenanceServiceTypeId: ['unknown or inactive'] }, formErrors: [] });
  const dup = await prisma().maintenanceSchedule.findFirst({ where: { vehicleId: v.id, maintenanceServiceTypeId: body.maintenanceServiceTypeId, isActive: true }, select: { id: true } });
  if (dup) throw new ConflictError('CONFLICT', 'An active schedule for this service type already exists on the vehicle', { scheduleId: dup.id });
  const base = { intervalDays: body.intervalDays ?? null, intervalKm: body.intervalKm ?? null, lastServiceAt: body.lastServiceAt ? new Date(body.lastServiceAt) : null, lastServiceOdometerKm: body.lastServiceOdometerKm ?? null };
  // Without a last service the clock starts now (odometer: the vehicle's current reading).
  const vehicle = await prisma().vehicle.findUniqueOrThrow({ where: { id: v.id }, select: { odometerKm: true } });
  const seeded = { ...base, lastServiceAt: base.lastServiceAt ?? new Date(), lastServiceOdometerKm: base.lastServiceOdometerKm ?? vehicle.odometerKm };
  const id = newId();
  await prisma().$transaction(async (tx) => {
    await tx.maintenanceSchedule.create({ data: { id, vehicleId: v.id, maintenanceServiceTypeId: body.maintenanceServiceTypeId, ...base, ...nextDue(seeded), isActive: body.isActive } });
    await writeAudit({ ...audit(scope), action: 'maintenance.schedule_created', entityType: 'maintenance_schedule', entityId: id, afterValue: { ...body } }, tx);
  });
  const row = await repo.findSchedule(scope, id);
  if (!row) throw new NotFoundError();
  return toScheduleDto(row);
}

export async function patchSchedule(scope: ActorScope, id: string, body: z.infer<typeof patchMaintenanceScheduleBody>): Promise<MaintenanceScheduleDto> {
  const s = await repo.findSchedule(scope, id);
  if (!s) throw new NotFoundError();
  const merged = {
    intervalDays: body.intervalDays === undefined ? s.intervalDays : body.intervalDays, intervalKm: body.intervalKm === undefined ? s.intervalKm : body.intervalKm,
    lastServiceAt: body.lastServiceAt === undefined ? s.lastServiceAt : body.lastServiceAt ? new Date(body.lastServiceAt) : null, lastServiceOdometerKm: body.lastServiceOdometerKm === undefined ? s.lastServiceOdometerKm : body.lastServiceOdometerKm,
  };
  if (!merged.intervalDays && !merged.intervalKm) throw new BusinessRuleError('VALIDATION_FAILED', 'An interval in km or days is required', { fieldErrors: { intervalDays: ['required'] }, formErrors: [] });
  await prisma().$transaction(async (tx) => {
    await tx.maintenanceSchedule.update({ where: { id }, data: { ...merged, ...nextDue(merged), ...(body.isActive !== undefined ? { isActive: body.isActive } : {}) } });
    await writeAudit({ ...audit(scope), action: 'maintenance.schedule_updated', entityType: 'maintenance_schedule', entityId: id, afterValue: { ...body } }, tx);
  });
  const row = await repo.findSchedule(scope, id);
  if (!row) throw new NotFoundError();
  return toScheduleDto(row);
}

export async function deleteSchedule(scope: ActorScope, id: string): Promise<void> {
  const s = await repo.findSchedule(scope, id);
  if (!s) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await tx.maintenanceSchedule.update({ where: { id }, data: { isActive: false } });
    await writeAudit({ ...audit(scope), action: 'maintenance.schedule_deleted', entityType: 'maintenance_schedule', entityId: id, beforeValue: { vehicleId: s.vehicleId } }, tx);
  });
}

export async function listDue(scope: AnyScope, q: z.infer<typeof maintenanceDueQuery>): Promise<MaintenanceDueDto[]> {
  const now = new Date();
  const rows = await repo.listDue(scope, q);
  const out = rows.map((s) => toDueDto(s, now));
  return q.overdueOnly ? out.filter((d) => d.overdue) : out;
}

// ── jobs ─────────────────────────────────────────────────────────────────────

/** Daily: one `maintenance.due` event per schedule inside the reminder horizon (the notifications module fans out). */
export async function maintenanceReminders(): Promise<number> {
  const [days, km] = await Promise.all([getSettingValue<number>('notifications.maintenance_reminder_days_before', 7), getSettingValue<number>('notifications.maintenance_reminder_km_before', 500)]);
  const due = await listDue(systemScope, { withinDays: days, withinKm: km });
  for (const d of due) await publishEvent('maintenance_schedule', d.scheduleId, 'maintenance.due', { vehicleId: d.vehicleId, ownerProfileId: d.ownerProfileId, serviceTypeCode: d.serviceTypeCode, nextDueAt: d.nextDueAt, nextDueOdometerKm: d.nextDueOdometerKm, overdue: d.overdue });
  return due.length;
}
