import type { ActorScope, AnyScope, SpoCommissionLineDto, SpoCustomerAssignmentDto, SpoLeadDto, SpoProfileDto } from '@unigate/types';
import type { convertSpoLeadBody, createSpoLeadBody, createSpoProfileBody, patchSpoLeadBody, patchSpoProfileBody } from '@unigate/validation';
import type { z } from 'zod';
import { normaliseIdentifier } from '@/common/crypto.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { bumpPermissionVersion } from '@/modules/iam/permission.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { toSpoAssignmentDto, toSpoCommissionDto, toSpoLeadDto, toSpoProfileDto } from './profiles.mapper.js';
import * as repo from './spo.repository.js';

/** Sales & partnership officers: profiles, customer assignments, leads, attributed commissions (api.md §8.7). */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

export async function listSpos(scope: AnyScope, f: { regionId?: string | undefined; isActive?: boolean | undefined; q?: string | undefined }, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listSpos(scope, f, page);
  return { items: items.map(toSpoProfileDto), total };
}

export async function getSpo(scope: AnyScope, id: string): Promise<SpoProfileDto> {
  const s = await repo.findSpo(scope, id);
  if (!s) throw new NotFoundError();
  return toSpoProfileDto(s);
}

async function ensureSpoRole(userId: string, grantedBy: string): Promise<void> {
  const role = await prisma().role.findUniqueOrThrow({ where: { code: 'SPO' }, select: { id: true } });
  const has = await prisma().userRole.findFirst({ where: { userId, roleId: role.id }, select: { userId: true } });
  if (!has) {
    await prisma().userRole.create({ data: { userId, roleId: role.id, grantedBy } });
    await bumpPermissionVersion(userId);
  }
}

export async function createSpo(scope: ActorScope, body: z.infer<typeof createSpoProfileBody>): Promise<SpoProfileDto> {
  const user = await prisma().user.findFirst({ where: { id: body.userId, deletedAt: null }, select: { id: true, spoProfile: { select: { id: true } } } });
  if (!user) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown user', { fieldErrors: { userId: ['unknown user'] }, formErrors: [] });
  if (user.spoProfile) throw new ConflictError('CONFLICT', 'User already has an SPO profile');
  if (await prisma().spoProfile.findUnique({ where: { employeeCode: body.employeeCode }, select: { id: true } })) throw new ConflictError('CONFLICT', 'Employee code already in use');
  const id = newId();
  await prisma().$transaction(async (tx) => {
    await tx.spoProfile.create({ data: { id, userId: body.userId, employeeCode: body.employeeCode, regionId: body.regionId ?? null, managerUserId: body.managerUserId ?? null, commissionModelId: body.commissionModelId ?? null } });
    await writeAudit({ ...audit(scope), action: 'spo.created', entityType: 'spo_profile', entityId: id, severity: 'NOTICE', afterValue: { userId: body.userId, employeeCode: body.employeeCode, regionId: body.regionId ?? null } }, tx);
  });
  await ensureSpoRole(body.userId, scope.actor.userId);
  return getSpo(scope, id);
}

export async function patchSpo(scope: ActorScope, id: string, body: z.infer<typeof patchSpoProfileBody>): Promise<SpoProfileDto> {
  const before = await repo.findSpo(scope, id);
  if (!before) throw new NotFoundError();
  if (body.employeeCode && body.employeeCode !== before.employeeCode && (await prisma().spoProfile.findUnique({ where: { employeeCode: body.employeeCode }, select: { id: true } }))) {
    throw new ConflictError('CONFLICT', 'Employee code already in use');
  }
  await prisma().$transaction(async (tx) => {
    await tx.spoProfile.update({
      where: { id },
      data: {
        ...(body.employeeCode !== undefined ? { employeeCode: body.employeeCode } : {}),
        ...(body.regionId !== undefined ? { regionId: body.regionId } : {}),
        ...(body.managerUserId !== undefined ? { managerUserId: body.managerUserId } : {}),
        ...(body.commissionModelId !== undefined ? { commissionModelId: body.commissionModelId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      },
    });
    await writeAudit({ ...audit(scope), action: 'spo.updated', entityType: 'spo_profile', entityId: id, beforeValue: { employeeCode: before.employeeCode, regionId: before.regionId, isActive: before.isActive }, afterValue: { ...body }, changedFields: Object.keys(body) }, tx);
  });
  return getSpo(scope, id);
}

export async function listAssignments(scope: AnyScope, spoProfileId: string): Promise<SpoCustomerAssignmentDto[]> {
  const rows = await repo.listAssignments(scope, spoProfileId);
  if (!rows) throw new NotFoundError();
  return rows.map(toSpoAssignmentDto);
}

/** One active assignment per customer: any other SPO's live assignment is closed first. */
export async function assignCustomer(scope: ActorScope, spoProfileId: string, customerProfileId: string): Promise<SpoCustomerAssignmentDto> {
  const spo = await repo.findSpo(scope, spoProfileId);
  if (!spo) throw new NotFoundError();
  if (!spo.isActive) throw new BusinessRuleError('VALIDATION_FAILED', 'SPO profile is inactive', { fieldErrors: {}, formErrors: ['inactive SPO'] });
  const customer = await prisma().customerProfile.findFirst({ where: { id: customerProfileId, user: { deletedAt: null } }, select: { id: true } });
  if (!customer) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown customer', { fieldErrors: { customerProfileId: ['unknown customer'] }, formErrors: [] });
  const id = newId();
  await prisma().$transaction(async (tx) => {
    await tx.spoCustomerAssignment.updateMany({ where: { customerProfileId, unassignedAt: null }, data: { unassignedAt: new Date() } });
    await tx.spoCustomerAssignment.create({ data: { id, spoProfileId, customerProfileId, assignedBy: scope.actor.userId } });
    await writeAudit({ ...audit(scope), action: 'spo.customer_assigned', entityType: 'spo_customer_assignment', entityId: id, afterValue: { spoProfileId, customerProfileId } }, tx);
  });
  const row = await prisma().spoCustomerAssignment.findUniqueOrThrow({ where: { id }, select: repo.assignmentSelect });
  return toSpoAssignmentDto(row);
}

export async function unassignCustomer(scope: ActorScope, spoProfileId: string, customerProfileId: string): Promise<void> {
  const spo = await repo.findSpo(scope, spoProfileId);
  if (!spo) throw new NotFoundError();
  const live = await prisma().spoCustomerAssignment.findFirst({ where: { spoProfileId, customerProfileId, unassignedAt: null }, select: { id: true } });
  if (!live) throw new NotFoundError();
  await prisma().$transaction(async (tx) => {
    await tx.spoCustomerAssignment.update({ where: { id: live.id }, data: { unassignedAt: new Date() } });
    await writeAudit({ ...audit(scope), action: 'spo.customer_unassigned', entityType: 'spo_customer_assignment', entityId: live.id, beforeValue: { spoProfileId, customerProfileId } }, tx);
  });
}

// ── leads ────────────────────────────────────────────────────────────────────

export async function listLeads(scope: AnyScope, f: { status?: string | undefined; spoProfileId?: string | undefined; q?: string | undefined }, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listLeads(scope, f, page);
  return { items: items.map(toSpoLeadDto), total };
}

export async function createLead(scope: ActorScope, body: z.infer<typeof createSpoLeadBody>): Promise<SpoLeadDto> {
  const spoProfileId = scope.kind === 'GLOBAL' ? (body.spoProfileId ?? scope.actor.spoProfileId) : scope.actor.spoProfileId;
  if (!spoProfileId) throw new BusinessRuleError('VALIDATION_FAILED', 'An SPO profile is required to create a lead', { fieldErrors: { spoProfileId: ['required'] }, formErrors: [] });
  const id = newId();
  await prisma().$transaction(async (tx) => {
    await tx.spoLead.create({ data: { id, spoProfileId, contactName: body.contactName, contactPhone: normaliseIdentifier(body.contactPhone), companyName: body.companyName ?? null, notes: body.notes ?? null } });
    await writeAudit({ ...audit(scope), action: 'spo.lead_created', entityType: 'spo_lead', entityId: id, afterValue: { spoProfileId, companyName: body.companyName ?? null } }, tx);
  });
  const row = await repo.findLead(scope, id);
  if (!row) throw new NotFoundError();
  return toSpoLeadDto(row);
}

export async function patchLead(scope: ActorScope, id: string, body: z.infer<typeof patchSpoLeadBody>): Promise<SpoLeadDto> {
  const before = await repo.findLead(scope, id);
  if (!before) throw new NotFoundError();
  if (before.status === 'CONVERTED') throw new ConflictError('CONFLICT', 'A converted lead is read-only');
  await prisma().$transaction(async (tx) => {
    await tx.spoLead.update({
      where: { id },
      data: {
        ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
        ...(body.contactPhone !== undefined ? { contactPhone: normaliseIdentifier(body.contactPhone) } : {}),
        ...(body.companyName !== undefined ? { companyName: body.companyName } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
    await writeAudit({ ...audit(scope), action: 'spo.lead_updated', entityType: 'spo_lead', entityId: id, beforeValue: { status: before.status }, afterValue: { ...body }, changedFields: Object.keys(body) }, tx);
  });
  const row = await repo.findLead(scope, id);
  if (!row) throw new NotFoundError();
  return toSpoLeadDto(row);
}

/** QUALIFIED → CONVERTED: creates the customer account with the attribution chain written. */
export async function convertLead(scope: ActorScope, id: string, body: z.infer<typeof convertSpoLeadBody>): Promise<{ lead: SpoLeadDto; customerProfileId: string; userId: string }> {
  const lead = await repo.findLead(scope, id);
  if (!lead) throw new NotFoundError();
  if (lead.status !== 'QUALIFIED') throw new BusinessRuleError('VALIDATION_FAILED', `Only a QUALIFIED lead can be converted (current: ${lead.status})`, { fieldErrors: { status: [lead.status] }, formErrors: [] });
  const phone = normaliseIdentifier(lead.contactPhone);
  const email = body.email ? normaliseIdentifier(body.email) : null;
  const taken = await prisma().user.findFirst({ where: { deletedAt: null, OR: [{ phoneE164: phone }, ...(email ? [{ email }] : [])] }, select: { id: true } });
  if (taken) throw new ConflictError('AUTH_IDENTIFIER_TAKEN', 'A user with this phone or email already exists');
  const role = await prisma().role.findUniqueOrThrow({ where: { code: 'CUSTOMER' }, select: { id: true } });
  const userId = newId();
  const customerProfileId = newId();
  await prisma().$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, email, phoneE164: phone, fullNameEn: body.fullNameEn, fullNameAr: body.fullNameAr ?? null, status: 'ACTIVE', preferredLocale: body.preferredLocale } });
    await tx.userRole.create({ data: { userId, roleId: role.id, grantedBy: scope.actor.userId } });
    await tx.customerProfile.create({ data: { id: customerProfileId, userId, customerType: body.customerType, acquiredBySpoId: lead.spoProfileId } });
    await tx.spoCustomerAssignment.create({ data: { id: newId(), spoProfileId: lead.spoProfileId, customerProfileId, assignedBy: scope.actor.userId } });
    await tx.spoLead.update({ where: { id }, data: { status: 'CONVERTED', convertedUserId: userId } });
    await writeAudit({ ...audit(scope), action: 'spo.lead_converted', entityType: 'spo_lead', entityId: id, severity: 'NOTICE', afterValue: { userId, customerProfileId, spoProfileId: lead.spoProfileId } }, tx);
    await publishEvent('customer', customerProfileId, 'customer.created', { userId, customerType: body.customerType, locale: body.preferredLocale, source: 'spo_lead', spoProfileId: lead.spoProfileId }, tx);
  });
  const row = await repo.findLead(scope, id);
  if (!row) throw new NotFoundError();
  return { lead: toSpoLeadDto(row), customerProfileId, userId };
}

export async function listCommissions(scope: AnyScope, f: { spoProfileId?: string | undefined; dateFrom?: string | undefined; dateTo?: string | undefined }, page: { page: number; pageSize: number }): Promise<{ items: SpoCommissionLineDto[]; total: number }> {
  const { items, total } = await repo.listCommissionLines(scope, f, page);
  return { items: items.map(toSpoCommissionDto), total };
}
