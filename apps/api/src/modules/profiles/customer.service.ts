import type { ActorScope, AnyScope, CustomerCreditDto, CustomerDto } from '@unigate/types';
import type { adminCreditBody, adminVatNumberBody, createCustomerBody, patchCustomerBody, upsertCorporateBody } from '@unigate/validation';
import type { z } from 'zod';
import { normaliseIdentifier } from '@/common/crypto.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { money, toMoneyString } from '@/common/money.js';
import { cacheGet, cacheSet } from '@/common/throttle.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { mandatoryDocumentsSatisfied } from '@/modules/documents/documents.service.js';
import { bumpPermissionVersion } from '@/modules/iam/permission.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import * as repo from './customer.repository.js';
import { toCustomerDto, toNationalAddress } from './profiles.mapper.js';

/** Customers and the corporate extension (api.md §8.4, FR-PROFILES-01/02/13/14). */

const CREDIT_CACHE_SECONDS = 30;

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

/** Self and staff (GLOBAL scope) see the phone; counterparties (PARTY scope, Phase 8) see it masked. */
function viewerSeesPii(scope: AnyScope, row: repo.CustomerRow): boolean {
  if (scope.kind === 'SYSTEM' || scope.kind === 'GLOBAL') return true;
  return scope.actor.userId === row.userId;
}

export async function listCustomers(scope: AnyScope, filters: repo.CustomerFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listCustomers(scope, filters, page);
  return { items: items.map((c) => toCustomerDto(c, viewerSeesPii(scope, c))), total };
}

export async function getCustomer(scope: AnyScope, id: string): Promise<CustomerDto> {
  const c = await repo.findCustomer(scope, id);
  if (!c) throw new NotFoundError();
  return toCustomerDto(c, viewerSeesPii(scope, c));
}

/** Staff/SPO-created customer: an ACTIVE, phone-unverified user who signs in by OTP (verifies the phone). */
export async function createCustomer(scope: ActorScope, body: z.infer<typeof createCustomerBody>): Promise<CustomerDto> {
  const phone = normaliseIdentifier(body.phoneE164);
  const email = body.email ? normaliseIdentifier(body.email) : null;
  const taken = await prisma().user.findFirst({ where: { deletedAt: null, OR: [{ phoneE164: phone }, ...(email ? [{ email }] : [])] }, select: { id: true } });
  if (taken) throw new ConflictError('AUTH_IDENTIFIER_TAKEN', 'Phone or email already in use');
  if (body.acquiredBySpoId && !(await prisma().spoProfile.findFirst({ where: { id: body.acquiredBySpoId, isActive: true }, select: { id: true } }))) {
    throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown SPO', { fieldErrors: { acquiredBySpoId: ['unknown or inactive SPO profile'] }, formErrors: [] });
  }
  const role = await prisma().role.findUniqueOrThrow({ where: { code: 'CUSTOMER' }, select: { id: true } });
  const userId = newId();
  const profileId = newId();
  await prisma().$transaction(async (tx) => {
    await tx.user.create({ data: { id: userId, email, phoneE164: phone, fullNameEn: body.fullNameEn, fullNameAr: body.fullNameAr ?? null, status: 'ACTIVE', preferredLocale: body.preferredLocale } });
    await tx.userRole.create({ data: { userId, roleId: role.id, grantedBy: scope.actor.userId } });
    await tx.customerProfile.create({ data: { id: profileId, userId, customerType: body.customerType, defaultCityId: body.defaultCityId ?? null, vatNumber: body.vatNumber ?? null, acquiredBySpoId: body.acquiredBySpoId ?? null } });
    if (body.acquiredBySpoId) await tx.spoCustomerAssignment.create({ data: { id: newId(), spoProfileId: body.acquiredBySpoId, customerProfileId: profileId, assignedBy: scope.actor.userId } });
    await writeAudit({ ...audit(scope), action: 'customer.created', entityType: 'customer_profile', entityId: profileId, severity: 'NOTICE', afterValue: { userId, customerType: body.customerType, acquiredBySpoId: body.acquiredBySpoId ?? null, createdBy: 'staff' } }, tx);
    await publishEvent('customer', profileId, 'customer.created', { userId, customerType: body.customerType, locale: body.preferredLocale, source: 'staff' }, tx);
  });
  return getCustomer(scope, profileId);
}

function vatLock(row: repo.CustomerRow): { lockedAt: Date; invoiceNumber: string } | null {
  const first = row.invoices[0];
  return first ? { lockedAt: first.issueDate, invoiceNumber: first.invoiceNumber } : null;
}

export async function patchCustomer(scope: ActorScope, id: string, body: z.infer<typeof patchCustomerBody>): Promise<CustomerDto> {
  const before = await repo.findCustomer(scope, id);
  if (!before) throw new NotFoundError();
  if (body.vatNumber !== undefined && body.vatNumber !== before.vatNumber) {
    const lock = vatLock(before);
    if (lock) {
      throw new BusinessRuleError('VALIDATION_FAILED', 'VAT number is locked once an invoice has been issued against it', { fieldErrors: { vatNumber: ['locked by an issued invoice; use the admin correction route'] }, formErrors: [], lockedByInvoiceNumber: lock.invoiceNumber });
    }
  }
  await prisma().$transaction(async (tx) => {
    await tx.customerProfile.update({
      where: { id },
      data: {
        ...(body.defaultCityId !== undefined ? { defaultCityId: body.defaultCityId } : {}),
        ...(body.vatNumber !== undefined ? { vatNumber: body.vatNumber, vatNumberVerifiedAt: null } : {}),
        ...(body.acquiredBySpoId !== undefined ? { acquiredBySpoId: body.acquiredBySpoId } : {}),
      },
    });
    await writeAudit({ ...audit(scope), action: 'customer.updated', entityType: 'customer_profile', entityId: id, beforeValue: { defaultCityId: before.defaultCityId, vatNumber: before.vatNumber, acquiredBySpoId: before.acquiredBySpoId }, afterValue: { ...body }, changedFields: Object.keys(body) }, tx);
  });
  return getCustomer(scope, id);
}

/** Upsert the corporate extension; identity changes on a verified record drop the verification. */
export async function upsertCorporate(scope: ActorScope, id: string, body: z.infer<typeof upsertCorporateBody>): Promise<CustomerDto> {
  const before = await repo.findCustomer(scope, id);
  if (!before) throw new NotFoundError();
  const a = body.nationalAddress;
  const identityChanged = before.corporate ? before.corporate.crNumber !== body.crNumber || before.corporate.companyNameEn !== body.companyNameEn : false;
  const data = {
    companyNameEn: body.companyNameEn,
    companyNameAr: body.companyNameAr,
    crNumber: body.crNumber,
    contactPersonName: body.contactPersonName,
    contactPersonPhone: normaliseIdentifier(body.contactPersonPhone),
    contactPersonEmail: body.contactPersonEmail ? normaliseIdentifier(body.contactPersonEmail) : null,
    ...(body.creditTermsDays !== undefined ? { creditTermsDays: body.creditTermsDays } : {}),
    ...(body.billingCycle ? { billingCycle: body.billingCycle } : {}),
    ...(body.invoiceLineGranularity ? { invoiceLineGranularity: body.invoiceLineGranularity } : {}),
    ...(a
      ? {
          addressBuildingNumber: a.buildingNumber, addressStreetEn: a.streetEn, addressStreetAr: a.streetAr, addressDistrictEn: a.districtEn, addressDistrictAr: a.districtAr,
          addressCityId: a.cityId, addressPostalCode: a.postalCode, addressAdditionalNumber: a.additionalNumber, addressShortCode: a.shortCode ?? null,
        }
      : {}),
    ...(identityChanged ? { isVerified: false } : {}),
  };
  await prisma().$transaction(async (tx) => {
    if (a && !(await tx.city.findFirst({ where: { id: a.cityId }, select: { id: true } }))) {
      throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown city', { fieldErrors: { 'nationalAddress.cityId': ['unknown city'] }, formErrors: [] });
    }
    await tx.customerProfile.update({ where: { id }, data: { customerType: 'CORPORATE' } });
    if (before.corporate) {
      await tx.corporateCustomerProfile.update({ where: { customerProfileId: id }, data });
    } else {
      await tx.corporateCustomerProfile.create({ data: { id: newId(), customerProfileId: id, ...data } });
    }
    await writeAudit({ ...audit(scope), action: 'customer.corporate_upserted', entityType: 'customer_profile', entityId: id, severity: identityChanged ? 'NOTICE' : 'INFO', beforeValue: before.corporate ? { crNumber: before.corporate.crNumber, companyNameEn: before.corporate.companyNameEn, isVerified: before.corporate.isVerified } : null, afterValue: { crNumber: body.crNumber, companyNameEn: body.companyNameEn, verificationDropped: identityChanged } }, tx);
  });
  return getCustomer(scope, id);
}

/**
 * Verified = CR, VAT number and the full national address are present AND the mandatory
 * corporate documents are verified (FR-PROFILES-14). Prerequisite for credit, not a grant.
 */
export async function verifyCustomer(scope: ActorScope, id: string, notes?: string): Promise<CustomerDto> {
  const c = await repo.findCustomer(scope, id);
  if (!c) throw new NotFoundError();
  if (!c.corporate) throw new BusinessRuleError('VALIDATION_FAILED', 'Customer has no corporate profile to verify', { fieldErrors: {}, formErrors: ['corporate profile required'] });
  const fieldErrors: Record<string, string[]> = {};
  if (!c.vatNumber) fieldErrors['vatNumber'] = ['required for a standard tax invoice (BR-KSA-09)'];
  if (!toNationalAddress(c.corporate).isComplete) fieldErrors['nationalAddress'] = ['building, street, district, city, postal code and additional number are all required'];
  const docs = await mandatoryDocumentsSatisfied('CORPORATE_CUSTOMER', c.corporate.id, []);
  if (!docs.ok) fieldErrors['documents'] = docs.missing.map((m) => `${m} missing or unverified`);
  if (Object.keys(fieldErrors).length) throw new BusinessRuleError('VALIDATION_FAILED', 'Corporate record is not ready for verification', { fieldErrors, formErrors: [] });
  await prisma().$transaction(async (tx) => {
    await tx.corporateCustomerProfile.update({ where: { customerProfileId: id }, data: { isVerified: true } });
    await tx.customerProfile.update({ where: { id }, data: { vatNumberVerifiedAt: new Date() } });
    await writeAudit({ ...audit(scope), action: 'customer.verified', entityType: 'customer_profile', entityId: id, severity: 'NOTICE', afterValue: { isVerified: true, notes: notes ?? null, crNumber: c.corporate?.crNumber, vatNumber: c.vatNumber } }, tx);
    await publishEvent('customer', id, 'customer.verified', { corporateId: c.corporate?.id }, tx);
  });
  return getCustomer(scope, id);
}

async function creditPosition(scope: AnyScope, row: repo.CustomerRow, bypassCache = false): Promise<CustomerCreditDto> {
  const corp = row.corporate;
  if (!corp) throw new NotFoundError();
  const key = `credit:${row.id}`;
  let outstanding = money(0);
  let computedAt = new Date();
  const cached = bypassCache ? null : await cacheGet(key);
  if (cached) {
    const parsed = JSON.parse(cached) as { outstanding: string; at: string };
    outstanding = money(parsed.outstanding);
    computedAt = new Date(parsed.at);
  } else {
    outstanding = await repo.outstandingReceivable(scope, row.id);
    await cacheSet(key, JSON.stringify({ outstanding: outstanding.toFixed(2), at: computedAt.toISOString() }), CREDIT_CACHE_SECONDS);
  }
  const limit = money(corp.creditLimitAmount);
  const headroom = limit.minus(outstanding);
  return {
    customerProfileId: row.id,
    companyNameEn: corp.companyNameEn,
    isVerified: corp.isVerified,
    creditStatus: corp.creditStatus,
    creditLimitAmount: toMoneyString(limit),
    creditTermsDays: corp.creditTermsDays,
    billingCycle: corp.billingCycle,
    defaultBillingMode: corp.creditStatus === 'APPROVED' && corp.billingCycle !== 'PER_BOOKING' ? 'INVOICED' : 'PREPAID',
    outstandingAmount: toMoneyString(outstanding),
    availableAmount: toMoneyString(headroom.isNegative() ? 0 : headroom),
    headroomAmount: toMoneyString(headroom),
    currency: 'SAR',
    creditApprovedAt: corp.creditApprovedAt ? corp.creditApprovedAt.toISOString() : null,
    computedAt: computedAt.toISOString(),
  };
}

export async function getCredit(scope: AnyScope, id: string): Promise<CustomerCreditDto> {
  const c = await repo.findCustomer(scope, id);
  if (!c?.corporate) throw new NotFoundError();
  return creditPosition(scope, c);
}

/** PATCH /admin/customers/{id}/credit — the decision (A-46). No retroactive effect on bookings or invoices. */
export async function adminSetCredit(scope: ActorScope, id: string, body: z.infer<typeof adminCreditBody>): Promise<CustomerCreditDto> {
  const c = await repo.findCustomer(scope, id);
  if (!c?.corporate) throw new NotFoundError();
  const corp = c.corporate;
  const nextLimit = body.creditLimitAmount !== undefined ? money(body.creditLimitAmount) : money(corp.creditLimitAmount);
  const nextStatus = body.creditStatus ?? corp.creditStatus;
  if (nextStatus === 'APPROVED') {
    const fieldErrors: Record<string, string[]> = {};
    if (!corp.isVerified) fieldErrors['creditStatus'] = ['customer must be verified before credit is approved'];
    if (nextLimit.lte(0)) fieldErrors['creditLimitAmount'] = ['a positive credit limit is required for approval'];
    if (Object.keys(fieldErrors).length) throw new BusinessRuleError('VALIDATION_FAILED', 'Credit cannot be approved', { fieldErrors, formErrors: [] });
  }
  const before = { creditStatus: corp.creditStatus, creditLimitAmount: toMoneyString(corp.creditLimitAmount), creditTermsDays: corp.creditTermsDays, billingCycle: corp.billingCycle, creditSuspendedReason: corp.creditSuspendedReason };
  await prisma().$transaction(async (tx) => {
    await tx.corporateCustomerProfile.update({
      where: { customerProfileId: id },
      data: {
        creditStatus: nextStatus,
        creditLimitAmount: nextLimit,
        ...(body.creditTermsDays !== undefined ? { creditTermsDays: body.creditTermsDays } : {}),
        ...(body.billingCycle ? { billingCycle: body.billingCycle } : {}),
        ...(nextStatus === 'APPROVED' && corp.creditStatus !== 'APPROVED' ? { creditApprovedByUserId: scope.actor.userId, creditApprovedAt: new Date() } : {}),
        creditSuspendedReason: nextStatus === 'SUSPENDED' ? (body.reason ?? corp.creditSuspendedReason) : null,
      },
    });
    await writeAudit({
      ...audit(scope), action: 'customer.credit_changed', entityType: 'customer_profile', entityId: id, severity: 'NOTICE',
      beforeValue: before,
      afterValue: { creditStatus: nextStatus, creditLimitAmount: toMoneyString(nextLimit), creditTermsDays: body.creditTermsDays ?? corp.creditTermsDays, billingCycle: body.billingCycle ?? corp.billingCycle, reason: body.reason ?? null },
      changedFields: Object.keys(body),
    }, tx);
    await publishEvent('customer', id, 'customer.credit_changed', { creditStatus: nextStatus, creditLimitAmount: toMoneyString(nextLimit) }, tx);
  });
  const after = await repo.findCustomer(scope, id);
  if (!after) throw new NotFoundError();
  return creditPosition(scope, after, true);
}

/** Admin correction path for a locked VAT number; issued invoices are never touched. */
export async function adminSetVatNumber(scope: ActorScope, id: string, body: z.infer<typeof adminVatNumberBody>): Promise<CustomerDto> {
  const c = await repo.findCustomer(scope, id);
  if (!c) throw new NotFoundError();
  const lock = vatLock(c);
  await prisma().$transaction(async (tx) => {
    await tx.customerProfile.update({ where: { id }, data: { vatNumber: body.vatNumber, vatNumberVerifiedAt: null } });
    await writeAudit({ ...audit(scope), action: 'customer.vat_number_corrected', entityType: 'customer_profile', entityId: id, severity: 'NOTICE', beforeValue: { vatNumber: c.vatNumber, lockedByInvoiceNumber: lock?.invoiceNumber ?? null }, afterValue: { vatNumber: body.vatNumber, reason: body.reason }, changedFields: ['vatNumber'] }, tx);
  });
  return getCustomer(scope, id);
}

/** Ensures the CUSTOMER role is present on a user that gains a customer profile later (e.g. an owner who books). */
export async function ensureCustomerRole(userId: string, grantedBy: string | null): Promise<void> {
  const role = await prisma().role.findUniqueOrThrow({ where: { code: 'CUSTOMER' }, select: { id: true } });
  const has = await prisma().userRole.findFirst({ where: { userId, roleId: role.id }, select: { userId: true } });
  if (!has) {
    await prisma().userRole.create({ data: { userId, roleId: role.id, grantedBy } });
    await bumpPermissionVersion(userId);
  }
}
