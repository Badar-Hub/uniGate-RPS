import type { ActorScope, AnyScope, DriverAssignmentDto, DriverDto, TransportType } from '@unigate/types';
import type { createDriverBody, patchDriverBody } from '@unigate/validation';
import type { z } from 'zod';
import { blindIndex, encryptPii, last4, normaliseIdentifier } from '@/common/crypto.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { mandatoryDocumentsSatisfied } from '@/modules/documents/documents.service.js';
import { revokeSessionsOf } from '@/modules/iam/admin.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import * as repo from './driver.repository.js';
import { toAssignmentDto, toDriverDto } from './profiles.mapper.js';

/** Drivers: owner-managed records with an approval gate applied at dispatch (api.md §8.6). */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

function seesPii(scope: AnyScope, row: repo.DriverRow): boolean {
  if (scope.kind === 'SYSTEM') return true;
  const a = scope.actor;
  return a.userId === row.userId || (a.ownerProfileId !== null && a.ownerProfileId === row.ownerProfileId) || a.permissions.has('drivers.pii.reveal');
}

export async function listDrivers(scope: AnyScope, filters: repo.DriverFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listDrivers(scope, filters, page);
  return { items: items.map((d) => toDriverDto(d, seesPii(scope, d))), total };
}

export async function getDriver(scope: AnyScope, id: string): Promise<DriverDto> {
  const d = await repo.findDriver(scope, id);
  if (!d) throw new NotFoundError();
  return toDriverDto(d, seesPii(scope, d));
}

/** Creates the phone-only user (OTP login) and the profile under the acting owner. */
export async function createDriver(scope: ActorScope, body: z.infer<typeof createDriverBody>): Promise<DriverDto> {
  const ownerProfileId = scope.kind === 'GLOBAL' ? (body.ownerProfileId ?? scope.actor.ownerProfileId) : scope.actor.ownerProfileId;
  if (!ownerProfileId) throw new BusinessRuleError('VALIDATION_FAILED', 'An owner profile is required to create a driver', { fieldErrors: { ownerProfileId: ['required'] }, formErrors: [] });
  const owner = await prisma().ownerProfile.findFirst({ where: { id: ownerProfileId }, select: { id: true, onboardingStatus: true } });
  if (!owner) throw new NotFoundError();
  if (owner.onboardingStatus === 'SUSPENDED') throw new BusinessRuleError('OWNER_NOT_APPROVED', 'A suspended owner cannot add drivers');
  const phone = normaliseIdentifier(body.phoneE164);
  if (await prisma().user.findFirst({ where: { phoneE164: phone, deletedAt: null }, select: { id: true } })) throw new ConflictError('AUTH_IDENTIFIER_TAKEN', 'Phone already in use');
  if (new Date(body.licenseExpiryDate) < new Date()) throw new BusinessRuleError('DRIVER_LICENSE_EXPIRED', 'Licence expiry date is in the past');
  const role = await prisma().role.findUniqueOrThrow({ where: { code: 'DRIVER' }, select: { id: true } });
  const userId = newId();
  const id = newId();
  await prisma().$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, phoneE164: phone, fullNameEn: body.fullNameEn, fullNameAr: body.fullNameAr ?? null, status: 'ACTIVE', preferredLocale: body.preferredLocale } });
    await tx.userRole.create({ data: { userId, roleId: role.id, grantedBy: scope.actor.userId } });
    await tx.driverProfile.create({
      data: {
        id, userId, ownerProfileId, idType: body.idType,
        nationalIdEncrypted: encryptPii(body.nationalId), nationalIdLast4: last4(body.nationalId), nationalIdBlindIndex: blindIndex(body.nationalId),
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null,
        licenseNumberEncrypted: encryptPii(body.licenseNumber), licenseNumberLast4: last4(body.licenseNumber), licenseNumberBlindIndex: blindIndex(body.licenseNumber),
        licenseExpiryDate: new Date(body.licenseExpiryDate), licenseCategories: body.licenseCategories,
        approvalStatus: 'DRAFT', availabilityStatus: 'OFF_DUTY',
        emergencyContactName: body.emergencyContactName ?? null, emergencyContactPhone: body.emergencyContactPhone ? normaliseIdentifier(body.emergencyContactPhone) : null,
        verticalEligibility: { create: body.transportTypes.map((t) => ({ id: newId(), transportType: t, status: 'NOT_APPLIED' as const })) },
      },
    });
    await writeAudit({ ...audit(scope), action: 'driver.created', entityType: 'driver_profile', entityId: id, severity: 'NOTICE', afterValue: { userId, ownerProfileId, idType: body.idType, nationalIdLast4: last4(body.nationalId), licenseExpiryDate: body.licenseExpiryDate, transportTypes: body.transportTypes } }, tx);
    await publishEvent('driver', id, 'driver.created', { userId, ownerProfileId, locale: body.preferredLocale }, tx);
  });
  return getDriver(scope, id);
}

export async function patchDriver(scope: ActorScope, id: string, body: z.infer<typeof patchDriverBody>): Promise<DriverDto> {
  const before = await repo.findDriver(scope, id);
  if (!before) throw new NotFoundError();
  if (body.licenseExpiryDate && new Date(body.licenseExpiryDate) < new Date()) throw new BusinessRuleError('DRIVER_LICENSE_EXPIRED', 'Licence expiry date is in the past');
  await prisma().$transaction(async (tx) => {
    await tx.driverProfile.update({
      where: { id },
      data: {
        ...(body.idType ? { idType: body.idType } : {}),
        ...(body.nationalId ? { nationalIdEncrypted: encryptPii(body.nationalId), nationalIdLast4: last4(body.nationalId), nationalIdBlindIndex: blindIndex(body.nationalId) } : {}),
        ...(body.dateOfBirth !== undefined ? { dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : null } : {}),
        ...(body.licenseNumber ? { licenseNumberEncrypted: encryptPii(body.licenseNumber), licenseNumberLast4: last4(body.licenseNumber), licenseNumberBlindIndex: blindIndex(body.licenseNumber) } : {}),
        ...(body.licenseExpiryDate ? { licenseExpiryDate: new Date(body.licenseExpiryDate) } : {}),
        ...(body.licenseCategories ? { licenseCategories: body.licenseCategories } : {}),
        ...(body.emergencyContactName !== undefined ? { emergencyContactName: body.emergencyContactName } : {}),
        ...(body.emergencyContactPhone !== undefined ? { emergencyContactPhone: body.emergencyContactPhone ? normaliseIdentifier(body.emergencyContactPhone) : null } : {}),
      },
    });
    if (body.transportTypes) {
      for (const t of body.transportTypes) {
        await tx.driverVerticalEligibility.upsert({ where: { driverProfileId_transportType: { driverProfileId: id, transportType: t } }, create: { id: newId(), driverProfileId: id, transportType: t, status: 'NOT_APPLIED' }, update: {} });
      }
    }
    const { nationalId, licenseNumber, ...safe } = body;
    await writeAudit({ ...audit(scope), action: 'driver.updated', entityType: 'driver_profile', entityId: id, afterValue: { ...safe, nationalIdChanged: Boolean(nationalId), licenseNumberChanged: Boolean(licenseNumber) }, changedFields: Object.keys(body) }, tx);
  });
  return getDriver(scope, id);
}

function appliedVerticals(d: repo.DriverRow): TransportType[] {
  const v = d.verticalEligibility.filter((e) => e.status !== 'REJECTED').map((e) => e.transportType);
  return v.length ? v : ['PASSENGER'];
}

/** Approval requires verified mandatory DRIVER documents and an unexpired licence. */
export async function approveDriver(scope: ActorScope, id: string, notes?: string): Promise<DriverDto> {
  const d = await repo.findDriver(scope, id);
  if (!d) throw new NotFoundError();
  if (d.approvalStatus === 'APPROVED') throw new ConflictError('CONFLICT', 'Driver is already approved');
  if (d.licenseExpiryDate && d.licenseExpiryDate < new Date()) throw new BusinessRuleError('DRIVER_LICENSE_EXPIRED', 'Licence has expired');
  const verticals = appliedVerticals(d);
  const docs = await mandatoryDocumentsSatisfied('DRIVER', id, verticals);
  if (!docs.ok) throw new BusinessRuleError('OWNER_DOCUMENTS_INCOMPLETE', 'Mandatory driver documents are missing or unverified', { missing: docs.missing });
  await prisma().$transaction(async (tx) => {
    await tx.driverProfile.update({ where: { id }, data: { approvalStatus: 'APPROVED' } });
    for (const t of verticals) {
      await tx.driverVerticalEligibility.upsert({
        where: { driverProfileId_transportType: { driverProfileId: id, transportType: t } },
        create: { id: newId(), driverProfileId: id, transportType: t, status: 'APPROVED', approvedByUserId: scope.actor.userId, approvedAt: new Date(), notes: notes ?? null },
        update: { status: 'APPROVED', approvedByUserId: scope.actor.userId, approvedAt: new Date(), notes: notes ?? null },
      });
    }
    await writeAudit({ ...audit(scope), action: 'driver.approved', entityType: 'driver_profile', entityId: id, severity: 'NOTICE', beforeValue: { approvalStatus: d.approvalStatus }, afterValue: { approvalStatus: 'APPROVED', verticals, notes: notes ?? null } }, tx);
    await publishEvent('driver', id, 'driver.approved', { userId: d.userId, ownerProfileId: d.ownerProfileId, verticals }, tx);
  });
  return getDriver(scope, id);
}

export async function rejectDriver(scope: ActorScope, id: string, rejectionReason: string): Promise<DriverDto> {
  const d = await repo.findDriver(scope, id);
  if (!d) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await tx.driverProfile.update({ where: { id }, data: { approvalStatus: 'REJECTED', availabilityStatus: 'OFF_DUTY' } });
    await tx.driverVerticalEligibility.updateMany({ where: { driverProfileId: id, status: { in: ['UNDER_REVIEW', 'APPROVED', 'NOT_APPLIED'] } }, data: { status: 'REJECTED', notes: rejectionReason } });
    await writeAudit({ ...audit(scope), action: 'driver.rejected', entityType: 'driver_profile', entityId: id, severity: 'NOTICE', beforeValue: { approvalStatus: d.approvalStatus }, afterValue: { approvalStatus: 'REJECTED', rejectionReason } }, tx);
    await publishEvent('driver', id, 'driver.rejected', { userId: d.userId, ownerProfileId: d.ownerProfileId, rejectionReason }, tx);
  });
  return getDriver(scope, id);
}

/** OFF_DUTY ↔ AVAILABLE by the driver or their owner; ON_TRIP is system-owned. */
export async function setAvailability(scope: ActorScope, id: string, availabilityStatus: 'OFF_DUTY' | 'AVAILABLE'): Promise<DriverDto> {
  const d = await repo.findDriver(scope, id);
  if (!d) throw new NotFoundError();
  if (d.availabilityStatus === 'ON_TRIP') throw new ConflictError('DRIVER_ALREADY_ON_TRIP', 'Availability cannot change while the driver is on a trip');
  if (availabilityStatus === 'AVAILABLE' && d.approvalStatus !== 'APPROVED') throw new BusinessRuleError('DRIVER_NOT_APPROVED', 'Only an approved driver can go on duty');
  if (availabilityStatus === 'AVAILABLE' && d.licenseExpiryDate && d.licenseExpiryDate < new Date()) throw new BusinessRuleError('DRIVER_LICENSE_EXPIRED', 'Licence has expired');
  await prisma().$transaction(async (tx) => {
    await tx.driverProfile.update({ where: { id }, data: { availabilityStatus } });
    await writeAudit({ ...audit(scope), action: 'driver.availability_changed', entityType: 'driver_profile', entityId: id, beforeValue: { availabilityStatus: d.availabilityStatus }, afterValue: { availabilityStatus } }, tx);
  });
  return getDriver(scope, id);
}

export async function listAssignments(scope: AnyScope, id: string): Promise<DriverAssignmentDto[]> {
  const rows = await repo.listAssignments(scope, id);
  if (!rows) throw new NotFoundError();
  return rows.map(toAssignmentDto);
}

/** Deactivate: blocked on an active trip; the user is DEACTIVATED and every session revoked. */
export async function deactivateDriver(scope: ActorScope, id: string): Promise<void> {
  const d = await repo.findDriver(scope, id);
  if (!d) throw new NotFoundError();
  if (d.availabilityStatus === 'ON_TRIP') throw new ConflictError('DRIVER_ALREADY_ON_TRIP', 'Driver is on an active trip');
  await prisma().$transaction(async (tx) => {
    await tx.driverProfile.update({ where: { id }, data: { availabilityStatus: 'OFF_DUTY', approvalStatus: 'SUSPENDED' } });
    await tx.user.update({ where: { id: d.userId }, data: { status: 'DEACTIVATED' } });
    await tx.vehicleDriverAssignment.updateMany({ where: { driverProfileId: id, assignedTo: null }, data: { assignedTo: new Date(), unassignedReason: 'DRIVER_DEACTIVATED' } });
    await writeAudit({ ...audit(scope), action: 'driver.deactivated', entityType: 'driver_profile', entityId: id, severity: 'NOTICE', beforeValue: { approvalStatus: d.approvalStatus, userStatus: d.user.status } }, tx);
    await publishEvent('driver', id, 'driver.deactivated', { userId: d.userId, ownerProfileId: d.ownerProfileId }, tx);
  });
  await revokeSessionsOf(scope, d.userId, 'DRIVER_DEACTIVATED');
}
