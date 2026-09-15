import type { Prisma } from '@prisma/client';
import type { ActorScope, AnyScope, CalendarEntryDto, VehicleAssignmentDto, VehicleAvailabilityDto, VehicleDto } from '@unigate/types';
import type { createVehicleBody, patchVehicleBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money } from '@/common/money.js';
import { isExclusionViolation, prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { requirementsFor } from '@/modules/documents/documents.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getDriver } from '@/modules/profiles/driver.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import { verticalFor } from '@/verticals/registry.js';
import { toAssignmentDto, toCalendarEntryDto, toVehicleDto } from './fleet.mapper.js';
import { dispatchability, type Dispatchability } from './vehicle.policy.js';
import * as repo from './vehicle.repository.js';

/** Fleet (api.md §8.8): registration, approval, calendar, driver assignments, dispatchability. */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

const systemScope = (job: string): AnyScope => ({ kind: 'SYSTEM', jobName: job, requestId: 'internal' });

/** The vehicle's checklist: document_types for VEHICLE in the category's vertical, plus the plugin's extras. */
async function checklist(v: repo.VehicleRow) {
  const plugin = verticalFor(v.category.transportType);
  const reqs = await requirementsFor(systemScope('fleet.checklist'), 'VEHICLE', v.id, v.category.transportType);
  const extras = new Set(plugin.extraRequiredDocumentTypes('VEHICLE', categoryShape(v.category)));
  return reqs.map((r) => (extras.has(r.documentTypeCode) ? { ...r, isMandatory: true } : r));
}

export async function dispatchableNow(v: repo.VehicleRow, at?: Date): Promise<Dispatchability> {
  const [reqs, blocks] = await Promise.all([checklist(v), getSettingValue<boolean>('documents.expired_document_blocks_dispatch', true)]);
  return dispatchability(v, reqs, { expiredDocumentBlocksDispatch: blocks, ...(at ? { at } : {}) });
}

function revealVin(scope: AnyScope, v: repo.VehicleRow): boolean {
  return scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL' || scope.actor.ownerProfileId === v.ownerProfileId;
}

async function dto(scope: AnyScope, v: repo.VehicleRow): Promise<VehicleDto> {
  return toVehicleDto(v, await dispatchableNow(v), revealVin(scope, v));
}

export async function listVehicles(scope: AnyScope, filters: repo.VehicleFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listVehicles(scope, filters, page);
  return { items: await Promise.all(items.map((v) => dto(scope, v))), total };
}

export async function getVehicle(scope: AnyScope, id: string): Promise<VehicleDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  return dto(scope, v);
}

async function loadCategory(id: string) {
  const c = await prisma().vehicleCategory.findFirst({ where: { id, isActive: true } });
  if (!c) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or inactive vehicle category', { fieldErrors: { vehicleCategoryId: ['unknown or inactive category'] }, formErrors: [] });
  return c;
}

function categoryShape(c: { code: string; minPassengerCapacity: number | null; maxPassengerCapacity: number | null; minPayloadKg: { toString(): string } | null; maxPayloadKg: { toString(): string } | null }) {
  return { code: c.code, minPassengerCapacity: c.minPassengerCapacity, maxPassengerCapacity: c.maxPassengerCapacity, minPayloadKg: c.minPayloadKg?.toString() ?? null, maxPayloadKg: c.maxPayloadKg?.toString() ?? null };
}

async function assertMakeModel(makeId: string | null | undefined, modelId: string | null | undefined): Promise<void> {
  const fieldErrors: Record<string, string[]> = {};
  if (makeId && !(await prisma().vehicleMake.findFirst({ where: { id: makeId, isActive: true }, select: { id: true } }))) fieldErrors['vehicleMakeId'] = ['unknown make'];
  if (modelId) {
    const m = await prisma().vehicleModel.findFirst({ where: { id: modelId, isActive: true }, select: { makeId: true } });
    if (!m) fieldErrors['vehicleModelId'] = ['unknown model'];
    else if (makeId && m.makeId !== makeId) fieldErrors['vehicleModelId'] = ['model does not belong to the make'];
  }
  if (Object.keys(fieldErrors).length) throw new BusinessRuleError('VALIDATION_FAILED', 'Invalid make/model', { fieldErrors, formErrors: [] });
}

async function assertPlateAndVinFree(plateEn: string, vin: string | null | undefined, exceptId: string | null): Promise<void> {
  const normalised = plateEn.replace(/\s+/g, '').toLowerCase();
  const plateHits = await prisma().$queryRaw<{ id: string }[]>`SELECT id FROM vehicles WHERE deleted_at IS NULL AND LOWER(REPLACE(plate_number_en, ' ', '')) = ${normalised}`;
  if (plateHits.some((h) => h.id !== exceptId)) throw new ConflictError('VEHICLE_PLATE_TAKEN', 'A live vehicle already carries this plate');
  if (vin) {
    const vinHit = await prisma().vehicle.findFirst({ where: { vin, deletedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, select: { id: true } });
    if (vinHit) throw new ConflictError('VEHICLE_VIN_TAKEN', 'A live vehicle already carries this VIN');
  }
}

const dateOrNull = (s: string | null | undefined): Date | null | undefined => (s === undefined ? undefined : s === null ? null : new Date(s));

/** Register in DRAFT under the acting owner (staff may name the owner). Capacity is validated by the category's vertical. */
export async function createVehicle(scope: ActorScope, body: z.infer<typeof createVehicleBody>): Promise<VehicleDto> {
  const ownerProfileId = scope.kind === 'GLOBAL' ? (body.ownerProfileId ?? scope.actor.ownerProfileId) : scope.actor.ownerProfileId;
  if (!ownerProfileId) throw new BusinessRuleError('VALIDATION_FAILED', 'An owner profile is required to register a vehicle', { fieldErrors: { ownerProfileId: ['required'] }, formErrors: [] });
  const owner = await prisma().ownerProfile.findFirst({ where: { id: ownerProfileId }, select: { id: true, onboardingStatus: true } });
  if (!owner) throw new NotFoundError();
  if (owner.onboardingStatus === 'SUSPENDED') throw new BusinessRuleError('OWNER_NOT_APPROVED', 'A suspended owner cannot register vehicles');
  const category = await loadCategory(body.vehicleCategoryId);
  const capacity = verticalFor(category.transportType).validateVehicleCapacity(categoryShape(category), body);
  if (!capacity.ok) throw new BusinessRuleError('VALIDATION_FAILED', 'Capacity does not fit the category', { fieldErrors: capacity.fieldErrors, formErrors: [] });
  await assertMakeModel(body.vehicleMakeId, body.vehicleModelId);
  await assertPlateAndVinFree(body.plateNumberEn, body.vin, null);
  if (body.baseCityId && !(await prisma().city.findFirst({ where: { id: body.baseCityId, isActive: true }, select: { id: true } }))) {
    throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown city', { fieldErrors: { baseCityId: ['unknown city'] }, formErrors: [] });
  }
  const id = newId();
  await prisma().$transaction(async (tx) => {
    await tx.vehicle.create({
      data: {
        id, ownerProfileId, vehicleCategoryId: category.id, vehicleMakeId: body.vehicleMakeId ?? null, vehicleModelId: body.vehicleModelId ?? null, modelYear: body.modelYear,
        plateNumberEn: body.plateNumberEn, plateNumberAr: body.plateNumberAr ?? null, sequenceNumber: body.sequenceNumber ?? null, registrationNumber: body.registrationNumber, vin: body.vin ?? null, colorCode: body.colorCode,
        passengerCapacity: body.passengerCapacity ?? null, payloadCapacityKg: body.payloadCapacityKg !== undefined ? money(body.payloadCapacityKg) : null, cargoVolumeM3: body.cargoVolumeM3 !== undefined ? money(body.cargoVolumeM3) : null,
        cargoLengthCm: body.cargoLengthCm ?? null, cargoWidthCm: body.cargoWidthCm ?? null, cargoHeightCm: body.cargoHeightCm ?? null, bodyType: body.bodyType ?? null,
        hasRefrigeration: body.hasRefrigeration ?? false, hasTailLift: body.hasTailLift ?? false,
        insurancePolicyNumber: body.insurancePolicyNumber ?? null, insuranceExpiryDate: dateOrNull(body.insuranceExpiryDate) ?? null, registrationExpiryDate: dateOrNull(body.registrationExpiryDate) ?? null, inspectionExpiryDate: dateOrNull(body.inspectionExpiryDate) ?? null,
        odometerKm: body.odometerKm ?? null, baseCityId: body.baseCityId ?? null, notes: body.notes ?? null, approvalStatus: 'DRAFT', lifecycleStatus: 'ACTIVE', operationalStatus: 'IDLE',
      },
    });
    await writeAudit({ ...audit(scope), action: 'vehicle.created', entityType: 'vehicle', entityId: id, afterValue: { ownerProfileId, categoryCode: category.code, plateNumberEn: body.plateNumberEn, modelYear: body.modelYear } }, tx);
    await publishEvent('vehicle', id, 'vehicle.created', { ownerProfileId, categoryCode: category.code }, tx);
  });
  return getVehicle(scope, id);
}

const IDENTITY_FIELDS = ['plateNumberEn', 'vin', 'vehicleCategoryId'] as const;

export async function patchVehicle(scope: ActorScope, id: string, body: z.infer<typeof patchVehicleBody>): Promise<VehicleDto> {
  const before = await repo.findVehicle(scope, id);
  if (!before) throw new NotFoundError();
  if (before.lifecycleStatus === 'ARCHIVED') throw new BusinessRuleError('VEHICLE_INVALID_TRANSITION', 'An archived vehicle cannot be edited');
  if (body.lifecycleStatus && before.lifecycleStatus === 'SUSPENDED' && scope.kind !== 'GLOBAL') throw new BusinessRuleError('VEHICLE_INVALID_TRANSITION', 'A suspended vehicle can only be reactivated by an administrator');
  const category = body.vehicleCategoryId ? await loadCategory(body.vehicleCategoryId) : before.category;
  const merged = {
    passengerCapacity: body.passengerCapacity ?? before.passengerCapacity ?? undefined,
    payloadCapacityKg: body.payloadCapacityKg ?? (before.payloadCapacityKg ? Number(before.payloadCapacityKg) : undefined),
    cargoVolumeM3: body.cargoVolumeM3 ?? (before.cargoVolumeM3 ? Number(before.cargoVolumeM3) : undefined),
  };
  const capacity = verticalFor(category.transportType).validateVehicleCapacity(categoryShape(category), merged);
  if (!capacity.ok) throw new BusinessRuleError('VALIDATION_FAILED', 'Capacity does not fit the category', { fieldErrors: capacity.fieldErrors, formErrors: [] });
  await assertMakeModel(body.vehicleMakeId === undefined ? before.vehicleMakeId : body.vehicleMakeId, body.vehicleModelId === undefined ? before.vehicleModelId : body.vehicleModelId);
  if (body.plateNumberEn || body.vin) await assertPlateAndVinFree(body.plateNumberEn ?? before.plateNumberEn, body.vin === undefined ? before.vin : body.vin, id);
  // Identity edits after approval return the vehicle to PENDING_APPROVAL (api.md §8.8).
  const identityChanged = IDENTITY_FIELDS.some((f) => body[f] !== undefined && body[f] !== (f === 'vehicleCategoryId' ? before.vehicleCategoryId : before[f]));
  const reApprove = identityChanged && before.approvalStatus === 'APPROVED';

  await prisma().$transaction(async (tx) => {
    await tx.vehicle.update({
      where: { id },
      data: {
        ...(body.vehicleCategoryId ? { vehicleCategoryId: body.vehicleCategoryId } : {}),
        ...(body.vehicleMakeId !== undefined ? { vehicleMakeId: body.vehicleMakeId } : {}),
        ...(body.vehicleModelId !== undefined ? { vehicleModelId: body.vehicleModelId } : {}),
        ...(body.modelYear !== undefined ? { modelYear: body.modelYear } : {}),
        ...(body.plateNumberEn ? { plateNumberEn: body.plateNumberEn } : {}),
        ...(body.plateNumberAr !== undefined ? { plateNumberAr: body.plateNumberAr } : {}),
        ...(body.sequenceNumber !== undefined ? { sequenceNumber: body.sequenceNumber } : {}),
        ...(body.registrationNumber !== undefined ? { registrationNumber: body.registrationNumber } : {}),
        ...(body.vin !== undefined ? { vin: body.vin } : {}),
        ...(body.colorCode !== undefined ? { colorCode: body.colorCode } : {}),
        ...(body.passengerCapacity !== undefined ? { passengerCapacity: body.passengerCapacity } : {}),
        ...(body.payloadCapacityKg !== undefined ? { payloadCapacityKg: money(body.payloadCapacityKg) } : {}),
        ...(body.cargoVolumeM3 !== undefined ? { cargoVolumeM3: money(body.cargoVolumeM3) } : {}),
        ...(body.cargoLengthCm !== undefined ? { cargoLengthCm: body.cargoLengthCm } : {}),
        ...(body.cargoWidthCm !== undefined ? { cargoWidthCm: body.cargoWidthCm } : {}),
        ...(body.cargoHeightCm !== undefined ? { cargoHeightCm: body.cargoHeightCm } : {}),
        ...(body.bodyType !== undefined ? { bodyType: body.bodyType } : {}),
        ...(body.hasRefrigeration !== undefined ? { hasRefrigeration: body.hasRefrigeration } : {}),
        ...(body.hasTailLift !== undefined ? { hasTailLift: body.hasTailLift } : {}),
        ...(body.insurancePolicyNumber !== undefined ? { insurancePolicyNumber: body.insurancePolicyNumber } : {}),
        ...(body.insuranceExpiryDate !== undefined ? { insuranceExpiryDate: new Date(body.insuranceExpiryDate) } : {}),
        ...(body.registrationExpiryDate !== undefined ? { registrationExpiryDate: new Date(body.registrationExpiryDate) } : {}),
        ...(body.inspectionExpiryDate !== undefined ? { inspectionExpiryDate: new Date(body.inspectionExpiryDate) } : {}),
        ...(body.odometerKm !== undefined ? { odometerKm: body.odometerKm } : {}),
        ...(body.baseCityId !== undefined ? { baseCityId: body.baseCityId } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.lifecycleStatus ? { lifecycleStatus: body.lifecycleStatus } : {}),
        ...(reApprove ? { approvalStatus: 'PENDING_APPROVAL', approvedAt: null, approvedByUserId: null } : {}),
      },
    });
    await writeAudit({ ...audit(scope), action: 'vehicle.updated', entityType: 'vehicle', entityId: id, severity: reApprove ? 'NOTICE' : 'INFO', beforeValue: { plateNumberEn: before.plateNumberEn, vin: before.vin, vehicleCategoryId: before.vehicleCategoryId, approvalStatus: before.approvalStatus, lifecycleStatus: before.lifecycleStatus }, afterValue: { ...body, approvalStatus: reApprove ? 'PENDING_APPROVAL' : before.approvalStatus }, changedFields: Object.keys(body) }, tx);
  });
  return getVehicle(scope, id);
}

/** DRAFT / REJECTED → PENDING_APPROVAL once every mandatory document is VERIFIED and unexpired. */
export async function submitForApproval(scope: ActorScope, id: string): Promise<VehicleDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  if (!['DRAFT', 'REJECTED'].includes(v.approvalStatus)) throw new BusinessRuleError('VEHICLE_INVALID_TRANSITION', `Cannot submit a vehicle in status ${v.approvalStatus}`, { approvalStatus: v.approvalStatus });
  if (v.ownerProfile.onboardingStatus !== 'APPROVED') throw new BusinessRuleError('OWNER_NOT_APPROVED', 'The owner profile must be approved before vehicles are submitted');
  const maxAge = await getSettingValue<number | null>('onboarding.vehicle_max_age_years', null);
  if (maxAge !== null && new Date().getUTCFullYear() - v.modelYear > maxAge) {
    throw new BusinessRuleError('VALIDATION_FAILED', `Vehicles older than ${maxAge} years are not accepted`, { fieldErrors: { modelYear: [`older than ${maxAge} years`] }, formErrors: [] });
  }
  const reqs = await checklist(v);
  const missing = reqs.filter((r) => r.isMandatory && r.status !== 'VERIFIED').map((r) => `${r.documentTypeCode}:${r.status}`);
  if (missing.length) throw new BusinessRuleError('OWNER_DOCUMENTS_INCOMPLETE', 'Mandatory vehicle documents are missing, unverified or expired', { missing });
  await prisma().$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { approvalStatus: 'PENDING_APPROVAL', rejectionReason: null } });
    await writeAudit({ ...audit(scope), action: 'vehicle.submitted', entityType: 'vehicle', entityId: id, beforeValue: { approvalStatus: v.approvalStatus }, afterValue: { approvalStatus: 'PENDING_APPROVAL' } }, tx);
    await publishEvent('vehicle', id, 'vehicle.submitted', { ownerProfileId: v.ownerProfileId }, tx);
  });
  return getVehicle(scope, id);
}

export async function approveVehicle(scope: ActorScope, id: string, notes?: string): Promise<VehicleDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  if (v.approvalStatus !== 'PENDING_APPROVAL') throw new BusinessRuleError('VEHICLE_INVALID_TRANSITION', `Only a pending vehicle can be approved (current: ${v.approvalStatus})`, { approvalStatus: v.approvalStatus });
  await prisma().$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { approvalStatus: 'APPROVED', approvedByUserId: scope.actor.userId, approvedAt: new Date(), rejectionReason: null, lifecycleStatus: v.lifecycleStatus === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE' } });
    await writeAudit({ ...audit(scope), action: 'vehicle.approved', entityType: 'vehicle', entityId: id, severity: 'NOTICE', beforeValue: { approvalStatus: v.approvalStatus }, afterValue: { approvalStatus: 'APPROVED', notes: notes ?? null } }, tx);
    await publishEvent('vehicle', id, 'vehicle.approved', { ownerProfileId: v.ownerProfileId }, tx);
  });
  return getVehicle(scope, id);
}

export async function rejectVehicle(scope: ActorScope, id: string, rejectionReason: string): Promise<VehicleDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  if (v.approvalStatus !== 'PENDING_APPROVAL') throw new BusinessRuleError('VEHICLE_INVALID_TRANSITION', `Only a pending vehicle can be rejected (current: ${v.approvalStatus})`, { approvalStatus: v.approvalStatus });
  await prisma().$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { approvalStatus: 'REJECTED', rejectionReason } });
    await writeAudit({ ...audit(scope), action: 'vehicle.rejected', entityType: 'vehicle', entityId: id, severity: 'NOTICE', beforeValue: { approvalStatus: v.approvalStatus }, afterValue: { approvalStatus: 'REJECTED', rejectionReason } }, tx);
    await publishEvent('vehicle', id, 'vehicle.rejected', { ownerProfileId: v.ownerProfileId, rejectionReason }, tx);
  });
  return getVehicle(scope, id);
}

/** lifecycle → SUSPENDED; operational_status is untouched (a suspended vehicle mid-trip stays ON_TRIP, V1). */
export async function suspendVehicle(scope: ActorScope, id: string, reason: string): Promise<VehicleDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  if (v.lifecycleStatus === 'ARCHIVED') throw new BusinessRuleError('VEHICLE_INVALID_TRANSITION', 'An archived vehicle cannot be suspended');
  await prisma().$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { lifecycleStatus: 'SUSPENDED' } });
    await writeAudit({ ...audit(scope), action: 'vehicle.suspended', entityType: 'vehicle', entityId: id, severity: 'NOTICE', beforeValue: { lifecycleStatus: v.lifecycleStatus }, afterValue: { lifecycleStatus: 'SUSPENDED', reason } }, tx);
    await publishEvent('vehicle', id, 'vehicle.suspended', { ownerProfileId: v.ownerProfileId, reason }, tx);
  });
  return getVehicle(scope, id);
}

export async function reactivateVehicle(scope: ActorScope, id: string, notes?: string): Promise<VehicleDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  if (v.lifecycleStatus !== 'SUSPENDED') throw new BusinessRuleError('VEHICLE_INVALID_TRANSITION', `Only a suspended vehicle can be reactivated (current: ${v.lifecycleStatus})`);
  await prisma().$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { lifecycleStatus: 'ACTIVE' } });
    await writeAudit({ ...audit(scope), action: 'vehicle.reactivated', entityType: 'vehicle', entityId: id, severity: 'NOTICE', beforeValue: { lifecycleStatus: 'SUSPENDED' }, afterValue: { lifecycleStatus: 'ACTIVE', notes: notes ?? null } }, tx);
  });
  return getVehicle(scope, id);
}

/** Soft delete → ARCHIVED; refused while future reservations exist. */
export async function deleteVehicle(scope: ActorScope, id: string): Promise<void> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  if (v.operationalStatus === 'ON_TRIP' || v.operationalStatus === 'RESERVED') throw new ConflictError('VEHICLE_HAS_ACTIVE_BOOKINGS', 'The vehicle is reserved or on a trip');
  const future = await repo.countFutureReservations(scope, id);
  if (future > 0) throw new ConflictError('VEHICLE_HAS_ACTIVE_BOOKINGS', 'The vehicle has future reservations', { reservations: future });
  await prisma().$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id }, data: { deletedAt: new Date(), lifecycleStatus: 'ARCHIVED' } });
    await tx.vehicleDriverAssignment.updateMany({ where: { vehicleId: id, assignedTo: null }, data: { assignedTo: new Date(), unassignedReason: 'VEHICLE_ARCHIVED' } });
    await writeAudit({ ...audit(scope), action: 'vehicle.archived', entityType: 'vehicle', entityId: id, severity: 'NOTICE', beforeValue: { plateNumberEn: v.plateNumberEn, lifecycleStatus: v.lifecycleStatus } }, tx);
    await publishEvent('vehicle', id, 'vehicle.archived', { ownerProfileId: v.ownerProfileId }, tx);
  });
}

// ── calendar ─────────────────────────────────────────────────────────────────

export async function listCalendar(scope: AnyScope, id: string, from: Date, to: Date): Promise<CalendarEntryDto[]> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  return (await repo.listCalendar(scope, id, from, to)).map(toCalendarEntryDto);
}

/** Owner blackout. The EXCLUDE constraint decides; a 23P01 becomes 409 with the blocking entries. */
export async function addOwnerBlock(scope: ActorScope, id: string, body: { from: string; to: string; notes?: string | undefined }): Promise<CalendarEntryDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  const from = new Date(body.from);
  const to = new Date(body.to);
  const entryId = newId();
  try {
    await prisma().$transaction(async (tx) => {
      await repo.insertOwnerBlock(scope, { id: entryId, vehicleId: id, from, to, createdByUserId: scope.actor.userId, notes: body.notes ?? null }, tx);
      await writeAudit({ ...audit(scope), action: 'vehicle.calendar_blocked', entityType: 'vehicle_calendar_entry', entityId: entryId, afterValue: { vehicleId: id, from: from.toISOString(), to: to.toISOString(), notes: body.notes ?? null } }, tx);
    });
  } catch (e) {
    if (isExclusionViolation(e)) {
      const conflicts = (await repo.listCalendar(scope, id, from, to)).map(toCalendarEntryDto);
      throw new ConflictError('VEHICLE_CALENDAR_CONFLICT', 'The window overlaps an existing calendar entry', { conflicts: conflicts.map((c) => ({ entryId: c.id, entryType: c.entryType, period: c.period, bookingNumber: c.bookingNumber })) });
    }
    throw e;
  }
  const row = await repo.findCalendarEntry(scope, id, entryId);
  if (!row) throw new NotFoundError();
  return toCalendarEntryDto(row);
}

/** Releases an OWNER_BLOCK. Reservations and maintenance windows are released by their own flows. */
export async function releaseOwnerBlock(scope: ActorScope, id: string, entryId: string): Promise<void> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  const entry = await repo.findCalendarEntry(scope, id, entryId);
  if (!entry || entry.status === 'RELEASED') throw new NotFoundError();
  if (entry.entry_type !== 'OWNER_BLOCK') throw new BusinessRuleError('VEHICLE_INVALID_TRANSITION', 'Only owner blocks can be released here', { entryType: entry.entry_type });
  await repo.releaseCalendarEntry(scope, entryId);
  await writeAudit({ ...audit(scope), action: 'vehicle.calendar_released', entityType: 'vehicle_calendar_entry', entityId: entryId, beforeValue: { vehicleId: id, from: entry.period_from.toISOString(), to: entry.period_to.toISOString() } });
}

/** The question the bid form asks: is this vehicle usable for [from, to)? */
export async function availability(scope: AnyScope, id: string, from: Date, to: Date): Promise<VehicleAvailabilityDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  const [dispatchable, entries, reqs] = await Promise.all([dispatchableNow(v, from), repo.listCalendar(scope, id, from, to), checklist(v)]);
  const expiring = reqs.filter((r) => r.isMandatory && r.expiryDate && new Date(r.expiryDate) < to).map((r) => ({ documentTypeCode: r.documentTypeCode, expiryDate: r.expiryDate ?? '' }));
  const conflicts = entries.map((e) => ({ entryId: e.id, entryType: e.entry_type, period: { from: e.period_from.toISOString(), to: e.period_to.toISOString() } }));
  return { vehicleId: id, window: { from: from.toISOString(), to: to.toISOString() }, available: dispatchable.ok && conflicts.length === 0 && expiring.length === 0, dispatchable, conflicts, expiringDocuments: expiring };
}

// ── driver assignments ────────────────────────────────────────────────────────

export async function listAssignments(scope: AnyScope, id: string): Promise<VehicleAssignmentDto[]> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  return (await repo.listAssignments(scope, id)).map(toAssignmentDto);
}

/** Opens an assignment; a new primary closes the previous primary rather than overwriting it (FR-FLEET-09). */
export async function assignDriver(scope: ActorScope, id: string, driverProfileId: string, isPrimary: boolean): Promise<VehicleAssignmentDto> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  // The driver must be in the same scope (own driver for an owner; any for staff) — getDriver applies it.
  const driver = await getDriver(scope, driverProfileId).catch(() => null);
  if (!driver) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown driver', { fieldErrors: { driverProfileId: ['unknown driver or not yours'] }, formErrors: [] });
  if (driver.ownerProfileId !== v.ownerProfileId) throw new BusinessRuleError('VALIDATION_FAILED', 'Driver belongs to another owner', { fieldErrors: { driverProfileId: ['driver belongs to another owner'] }, formErrors: [] });
  if (driver.approvalStatus !== 'APPROVED') throw new BusinessRuleError('DRIVER_NOT_APPROVED', 'Only an approved driver can be assigned');
  if (driver.licenseExpiryDate && new Date(driver.licenseExpiryDate) < new Date()) throw new BusinessRuleError('DRIVER_LICENSE_EXPIRED', 'Driver licence has expired');
  const open = await prisma().vehicleDriverAssignment.findFirst({ where: { vehicleId: id, driverProfileId, assignedTo: null }, select: { id: true } });
  if (open) throw new ConflictError('CONFLICT', 'Driver is already assigned to this vehicle');
  const assignmentId = newId();
  await prisma().$transaction(async (tx) => {
    if (isPrimary) await tx.vehicleDriverAssignment.updateMany({ where: { vehicleId: id, isPrimary: true, assignedTo: null }, data: { assignedTo: new Date(), unassignedReason: 'REPLACED_AS_PRIMARY' } });
    await tx.vehicleDriverAssignment.create({ data: { id: assignmentId, vehicleId: id, driverProfileId, isPrimary, assignedFrom: new Date(), assignedByUserId: scope.actor.userId } });
    await writeAudit({ ...audit(scope), action: 'vehicle.driver_assigned', entityType: 'vehicle_driver_assignment', entityId: assignmentId, afterValue: { vehicleId: id, driverProfileId, isPrimary } }, tx);
    await publishEvent('vehicle', id, 'vehicle.driver_assigned', { driverProfileId, isPrimary }, tx);
  });
  const row = await repo.findAssignment(scope, id, assignmentId);
  if (!row) throw new NotFoundError();
  return toAssignmentDto(row);
}

export async function unassignDriver(scope: ActorScope, id: string, assignmentId: string, reason?: string): Promise<void> {
  const v = await repo.findVehicle(scope, id);
  if (!v) throw new NotFoundError();
  const a = await repo.findAssignment(scope, id, assignmentId);
  if (!a || a.assignedTo) throw new NotFoundError();
  if (v.operationalStatus === 'ON_TRIP') throw new ConflictError('DRIVER_ALREADY_ON_TRIP', 'The vehicle is on a trip; the assignment closes when it ends');
  await prisma().$transaction(async (tx) => {
    await tx.vehicleDriverAssignment.update({ where: { id: assignmentId }, data: { assignedTo: new Date(), unassignedReason: reason ?? 'UNASSIGNED' } });
    await writeAudit({ ...audit(scope), action: 'vehicle.driver_unassigned', entityType: 'vehicle_driver_assignment', entityId: assignmentId, beforeValue: { vehicleId: id, driverProfileId: a.driverProfileId }, afterValue: { reason: reason ?? null } }, tx);
  });
}

// ── matching (Phase 6) ────────────────────────────────────────────────────────

export interface DispatchableCandidate {
  id: string;
  ownerProfileId: string;
  categoryId: string;
  plateNumberEn: string;
  categoryCode: string;
  passengerCapacity: number | null;
  payloadCapacityKg: string | null;
  hasRefrigeration: boolean;
  hasTailLift: boolean;
}

/** Vehicles that could serve a request: structural filter in the repository, then the dispatchability predicate. */
export async function dispatchableCandidates(input: { vehicleCategoryId: string; pickupCityId: string; transportType: 'PASSENGER' | 'GOODS'; from: Date; to: Date }): Promise<DispatchableCandidate[]> {
  const rows = await repo.listCandidates(systemScope('demand.match'), input);
  const out: DispatchableCandidate[] = [];
  for (const v of rows) {
    const d = await dispatchableNow(v, input.from);
    if (!d.ok) continue;
    out.push({ id: v.id, ownerProfileId: v.ownerProfileId, categoryId: v.vehicleCategoryId, plateNumberEn: v.plateNumberEn, categoryCode: v.category.code, passengerCapacity: v.passengerCapacity, payloadCapacityKg: v.payloadCapacityKg ? v.payloadCapacityKg.toString() : null, hasRefrigeration: v.hasRefrigeration, hasTailLift: v.hasTailLift });
  }
  return out;
}

// ── cross-module facts (Phase 7) ──────────────────────────────────────────────

export interface VehicleForAward {
  id: string;
  ownerProfileId: string;
  vehicleCategoryId: string;
  categoryCode: string;
  plateNumberEn: string;
  description: string;
  dispatch: Dispatchability;
  /** What the vertical plugin matches a request's detail block against (payload, refrigeration, …). */
  candidate: { id: string; categoryId: string; passengerCapacity: number | null; payloadCapacityKg: string | null; hasRefrigeration: boolean; hasTailLift: boolean };
}

/** The vehicle as the bidding/award path sees it: identity + the dispatchability verdict re-run now. Unscoped read (the bid already names the vehicle). */
export async function vehicleForAward(id: string, at?: Date): Promise<VehicleForAward | null> {
  const v = await repo.findVehicle(systemScope('bidding.vehicle'), id);
  if (!v) return null;
  const description = [v.make?.name, v.model?.name, String(v.modelYear), '—', v.category.nameEn].filter(Boolean).join(' ');
  return {
    id: v.id, ownerProfileId: v.ownerProfileId, vehicleCategoryId: v.vehicleCategoryId, categoryCode: v.category.code, plateNumberEn: v.plateNumberEn, description, dispatch: await dispatchableNow(v, at),
    candidate: { id: v.id, categoryId: v.vehicleCategoryId, passengerCapacity: v.passengerCapacity, payloadCapacityKg: v.payloadCapacityKg?.toString() ?? null, hasRefrigeration: v.hasRefrigeration, hasTailLift: v.hasTailLift },
  };
}

/** Is the driver currently assigned to this vehicle (an open vehicle_driver_assignments row)? */
export async function isDriverAssignedToVehicle(vehicleId: string, driverProfileId: string): Promise<boolean> {
  const rows = await repo.listAssignments(systemScope('bookings.dispatch'), vehicleId);
  return rows.some((a) => a.driverProfileId === driverProfileId && a.assignedTo === null);
}

// ── trip integration (Phase 10) ──────────────────────────────────────────────

/** System-driven operational status (database.md §7.1): the trip lifecycle owns IDLE ↔ ON_TRIP. */
export async function setOperationalStatus(vehicleId: string, status: 'IDLE' | 'RESERVED' | 'ON_TRIP', tx: Prisma.TransactionClient): Promise<void> {
  await tx.vehicle.update({ where: { id: vehicleId }, data: { operationalStatus: status } });
}

/** The odometer only moves forward; the caller refuses a lower reading (VALIDATION_FAILED). */
export async function updateOdometer(vehicleId: string, km: number, tx: Prisma.TransactionClient): Promise<void> {
  await tx.vehicle.updateMany({ where: { id: vehicleId, OR: [{ odometerKm: null }, { odometerKm: { lte: km } }] }, data: { odometerKm: km } });
}
