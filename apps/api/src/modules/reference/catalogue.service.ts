import type { createCategoryBody, createMakeBody, createModelBody, patchCategoryBody } from '@unigate/validation';
import type { z } from 'zod';
import type { ActorScope, CityDto, CodedLabelDto, DocumentAppliesTo, DocumentTypeDto, RegionDto, VehicleCategoryDto, VehicleMakeDto, VehicleModelDto } from '@unigate/types';
import type { VehicleCategory } from '@prisma/client';
import * as enums from '@unigate/types';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money, toMoneyString } from '@/common/money.js';
import { prisma } from '@/database/prisma.js';
import { writeAudit } from '@/modules/platform/audit.service.js';

/**
 * Reference catalogue (api.md §8.9): the seeded master data every form is built from.
 * Reads are public and cacheable; creation/deactivation is audited under reference.manage.
 * Rows are never hard-deleted — vehicles and requests reference them.
 */

const dec = (d: { toString(): string } | null) => (d ? toMoneyString(money(d.toString())) : null);

export async function listRegions(): Promise<RegionDto[]> {
  const rows = await prisma().region.findMany({ orderBy: { nameEn: 'asc' } });
  return rows.map((r) => ({ id: r.id, code: r.code, nameEn: r.nameEn, nameAr: r.nameAr }));
}

export async function listCities(f: { regionId?: string | undefined; q?: string | undefined; isActive?: boolean | undefined }): Promise<CityDto[]> {
  const rows = await prisma().city.findMany({
    where: {
      ...(f.regionId ? { regionId: f.regionId } : {}),
      ...(f.isActive !== undefined ? { isActive: f.isActive } : { isActive: true }),
      ...(f.q ? { OR: [{ nameEn: { contains: f.q, mode: 'insensitive' } }, { nameAr: { contains: f.q } }] } : {}),
    },
    orderBy: { nameEn: 'asc' },
  });
  return rows.map((c) => ({ id: c.id, regionId: c.regionId, code: c.code, nameEn: c.nameEn, nameAr: c.nameAr, latitude: c.latitude.toNumber(), longitude: c.longitude.toNumber(), isActive: c.isActive }));
}

function toCategoryDto(c: VehicleCategory): VehicleCategoryDto {
  return {
    id: c.id, code: c.code, nameEn: c.nameEn, nameAr: c.nameAr, transportType: c.transportType, descriptionEn: c.descriptionEn, descriptionAr: c.descriptionAr, iconKey: c.iconKey,
    minPassengerCapacity: c.minPassengerCapacity, maxPassengerCapacity: c.maxPassengerCapacity, minPayloadKg: dec(c.minPayloadKg), maxPayloadKg: dec(c.maxPayloadKg),
    requiresSpecialLicense: c.requiresSpecialLicense, sortOrder: c.sortOrder, isActive: c.isActive,
  };
}

export async function listCategories(f: { transportType?: string | undefined; isActive?: boolean | undefined }): Promise<VehicleCategoryDto[]> {
  const rows = await prisma().vehicleCategory.findMany({
    where: { ...(f.transportType ? { transportType: f.transportType as 'PASSENGER' | 'GOODS' } : {}), ...(f.isActive !== undefined ? { isActive: f.isActive } : { isActive: true }) },
    orderBy: [{ transportType: 'asc' }, { sortOrder: 'asc' }],
  });
  return rows.map(toCategoryDto);
}

export async function createCategory(scope: ActorScope, body: z.infer<typeof createCategoryBody>): Promise<VehicleCategoryDto> {
  if (await prisma().vehicleCategory.findUnique({ where: { code: body.code }, select: { id: true } })) throw new ConflictError('CONFLICT', 'Category code already exists');
  const id = newId();
  await prisma().$transaction(async (tx) => {
    await tx.vehicleCategory.create({
      data: {
        id, code: body.code, nameEn: body.nameEn, nameAr: body.nameAr, transportType: body.transportType, descriptionEn: body.descriptionEn ?? null, descriptionAr: body.descriptionAr ?? null, iconKey: body.iconKey ?? null,
        minPassengerCapacity: body.minPassengerCapacity ?? null, maxPassengerCapacity: body.maxPassengerCapacity ?? null,
        minPayloadKg: body.minPayloadKg !== undefined ? money(body.minPayloadKg) : null, maxPayloadKg: body.maxPayloadKg !== undefined ? money(body.maxPayloadKg) : null,
        requiresSpecialLicense: body.requiresSpecialLicense, sortOrder: body.sortOrder,
      },
    });
    await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'reference.category_created', entityType: 'vehicle_category', entityId: id, severity: 'NOTICE', afterValue: { ...body } }, tx);
  });
  const row = await prisma().vehicleCategory.findUniqueOrThrow({ where: { id } });
  return toCategoryDto(row);
}

export async function patchCategory(scope: ActorScope, id: string, body: z.infer<typeof patchCategoryBody>): Promise<VehicleCategoryDto> {
  const before = await prisma().vehicleCategory.findUnique({ where: { id } });
  if (!before) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await tx.vehicleCategory.update({
      where: { id },
      data: {
        ...(body.nameEn !== undefined ? { nameEn: body.nameEn } : {}),
        ...(body.nameAr !== undefined ? { nameAr: body.nameAr } : {}),
        ...(body.transportType ? { transportType: body.transportType } : {}),
        ...(body.descriptionEn !== undefined ? { descriptionEn: body.descriptionEn } : {}),
        ...(body.descriptionAr !== undefined ? { descriptionAr: body.descriptionAr } : {}),
        ...(body.iconKey !== undefined ? { iconKey: body.iconKey } : {}),
        ...(body.minPassengerCapacity !== undefined ? { minPassengerCapacity: body.minPassengerCapacity } : {}),
        ...(body.maxPassengerCapacity !== undefined ? { maxPassengerCapacity: body.maxPassengerCapacity } : {}),
        ...(body.minPayloadKg !== undefined ? { minPayloadKg: money(body.minPayloadKg) } : {}),
        ...(body.maxPayloadKg !== undefined ? { maxPayloadKg: money(body.maxPayloadKg) } : {}),
        ...(body.requiresSpecialLicense !== undefined ? { requiresSpecialLicense: body.requiresSpecialLicense } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'reference.category_updated', entityType: 'vehicle_category', entityId: id, beforeValue: { nameEn: before.nameEn, isActive: before.isActive }, afterValue: { ...body }, changedFields: Object.keys(body) }, tx);
  });
  return toCategoryDto(await prisma().vehicleCategory.findUniqueOrThrow({ where: { id } }));
}

export async function listMakes(): Promise<VehicleMakeDto[]> {
  const rows = await prisma().vehicleMake.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } });
  return rows.map((m) => ({ id: m.id, name: m.name, isActive: m.isActive }));
}

export async function createMake(scope: ActorScope, body: z.infer<typeof createMakeBody>): Promise<VehicleMakeDto> {
  if (await prisma().vehicleMake.findUnique({ where: { name: body.name }, select: { id: true } })) throw new ConflictError('CONFLICT', 'Make already exists');
  const row = await prisma().vehicleMake.create({ data: { id: newId(), name: body.name } });
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'reference.make_created', entityType: 'vehicle_make', entityId: row.id, afterValue: { name: body.name } });
  return { id: row.id, name: row.name, isActive: row.isActive };
}

export async function listModels(f: { makeId?: string | undefined; isActive?: boolean | undefined }): Promise<VehicleModelDto[]> {
  const rows = await prisma().vehicleModel.findMany({ where: { ...(f.makeId ? { makeId: f.makeId } : {}), ...(f.isActive !== undefined ? { isActive: f.isActive } : { isActive: true }) }, orderBy: [{ makeId: 'asc' }, { name: 'asc' }] });
  return rows.map((m) => ({ id: m.id, makeId: m.makeId, name: m.name, bodyType: m.bodyType, isActive: m.isActive }));
}

export async function createModel(scope: ActorScope, body: z.infer<typeof createModelBody>): Promise<VehicleModelDto> {
  if (!(await prisma().vehicleMake.findUnique({ where: { id: body.makeId }, select: { id: true } }))) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown make', { fieldErrors: { makeId: ['unknown make'] }, formErrors: [] });
  if (await prisma().vehicleModel.findUnique({ where: { makeId_name: { makeId: body.makeId, name: body.name } }, select: { id: true } })) throw new ConflictError('CONFLICT', 'Model already exists for this make');
  const row = await prisma().vehicleModel.create({ data: { id: newId(), makeId: body.makeId, name: body.name, bodyType: body.bodyType ?? null } });
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'reference.model_created', entityType: 'vehicle_model', entityId: row.id, afterValue: { makeId: body.makeId, name: body.name } });
  return { id: row.id, makeId: row.makeId, name: row.name, bodyType: row.bodyType, isActive: row.isActive };
}

export async function listDocumentTypes(f: { appliesTo?: string | undefined; isActive?: boolean | undefined }): Promise<DocumentTypeDto[]> {
  const rows = await prisma().documentType.findMany({
    where: { ...(f.appliesTo ? { appliesTo: f.appliesTo as DocumentAppliesTo } : {}), ...(f.isActive !== undefined ? { isActive: f.isActive } : { isActive: true }) },
    orderBy: [{ appliesTo: 'asc' }, { sortOrder: 'asc' }],
  });
  return rows.map((d) => ({
    code: d.code, nameEn: d.nameEn, nameAr: d.nameAr, appliesTo: d.appliesTo, transportType: d.transportType, requiresExpiry: d.requiresExpiry, isMandatory: d.isMandatory,
    maxSizeBytes: Number(d.maxSizeBytes), allowedMimeTypes: d.allowedMimeTypes, expiryWarningDays: d.expiryWarningDays, sortOrder: d.sortOrder, isActive: d.isActive,
  }));
}

export async function listExpenseCategories(): Promise<CodedLabelDto[]> {
  const rows = await prisma().expenseCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  return rows.map((r) => ({ id: r.id, code: r.code, nameEn: r.nameEn, nameAr: r.nameAr, isActive: r.isActive, sortOrder: r.sortOrder }));
}

export async function listMaintenanceServiceTypes(): Promise<CodedLabelDto[]> {
  const rows = await prisma().maintenanceServiceType.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } });
  return rows.map((r) => ({ id: r.id, code: r.code, nameEn: r.nameEn, nameAr: r.nameAr, isActive: r.isActive, sortOrder: r.sortOrder }));
}

/** Every domain enum plus the legal transition maps, so clients never hard-code lifecycles. */
export function enumCatalogue(): Record<string, unknown> {
  return {
    userStatus: enums.USER_STATUS,
    transportType: enums.TRANSPORT_TYPE,
    onboardingStatus: enums.ONBOARDING_STATUS,
    verticalApprovalStatus: enums.VERTICAL_APPROVAL_STATUS,
    driverAvailabilityStatus: enums.DRIVER_AVAILABILITY_STATUS,
    creditStatus: enums.CREDIT_STATUS,
    billingCycle: enums.BILLING_CYCLE,
    documentAppliesTo: enums.DOCUMENT_APPLIES_TO,
    documentUploadStatus: enums.DOCUMENT_UPLOAD_STATUS,
    documentVerificationStatus: enums.DOCUMENT_VERIFICATION_STATUS,
    documentVisibility: enums.DOCUMENT_VISIBILITY,
    vehicleApprovalStatus: enums.VEHICLE_APPROVAL_STATUS,
    vehicleLifecycleStatus: enums.VEHICLE_LIFECYCLE_STATUS,
    vehicleOperationalStatus: enums.VEHICLE_OPERATIONAL_STATUS,
    calendarEntryType: enums.CALENDAR_ENTRY_TYPE,
    calendarEntryStatus: enums.CALENDAR_ENTRY_STATUS,
    bookingStatus: enums.BOOKING_STATUS,
    bookingTransitions: enums.BOOKING_TRANSITIONS,
    vehicleApprovalTransitions: { DRAFT: ['PENDING_APPROVAL'], PENDING_APPROVAL: ['APPROVED', 'REJECTED'], REJECTED: ['PENDING_APPROVAL'], APPROVED: ['PENDING_APPROVAL'] },
    ownerOnboardingTransitions: { DRAFT: ['UNDER_REVIEW'], DOCUMENTS_SUBMITTED: ['UNDER_REVIEW'], UNDER_REVIEW: ['APPROVED', 'REJECTED'], REJECTED: ['UNDER_REVIEW'], APPROVED: ['UNDER_REVIEW', 'SUSPENDED'], SUSPENDED: [] },
  };
}
