import type { ActorScope, AnyScope, OwnerBankAccountDto, OwnerDto, TransportType, VendorCreatedDto } from '@unigate/types';
import type { createBankAccountBody, createOwnerBody, createVendorBody, patchOwnerBody } from '@unigate/validation';
import type { z } from 'zod';
import { blindIndex, encryptPii, last4 } from '@/common/crypto.js';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { mandatoryDocumentsSatisfied } from '@/modules/documents/documents.service.js';
import { activationUrl, createVendorAccount, getUser } from '@/modules/iam/admin.service.js';
import { bumpPermissionVersion } from '@/modules/iam/permission.service.js';
import { sendSecretLink } from '@/modules/notifications/notification.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { getSettingValue } from '@/modules/reference/settings.service.js';
import * as repo from './owner.repository.js';
import { parsePrivacy, toBankAccountDto, toOwnerDto } from './profiles.mapper.js';

/** Owners: onboarding state machine, verticals, service areas, payout accounts (api.md §8.5). */

function audit(scope: ActorScope) {
  return { actorUserId: scope.actor.userId, actorType: 'USER' as const, actorRoles: [...scope.actor.roles] };
}

function seesPii(scope: AnyScope, row: repo.OwnerRow): boolean {
  if (scope.kind === 'SYSTEM') return true;
  return scope.actor.userId === row.userId || scope.actor.permissions.has('owners.pii.reveal');
}

export async function listOwners(scope: AnyScope, filters: repo.OwnerFilters, page: { page: number; pageSize: number }) {
  const { items, total } = await repo.listOwners(scope, filters, page);
  return { items: items.map((o) => toOwnerDto(o, seesPii(scope, o))), total };
}

export async function getOwner(scope: AnyScope, id: string): Promise<OwnerDto> {
  const o = await repo.findOwner(scope, id);
  if (!o) throw new NotFoundError();
  return toOwnerDto(o, seesPii(scope, o));
}

async function ensureRole(userId: string, code: string, grantedBy: string): Promise<void> {
  const role = await prisma().role.findUniqueOrThrow({ where: { code }, select: { id: true } });
  const has = await prisma().userRole.findFirst({ where: { userId, roleId: role.id }, select: { userId: true } });
  if (!has) {
    await prisma().userRole.create({ data: { userId, roleId: role.id, grantedBy } });
    await bumpPermissionVersion(userId);
  }
}

/** Admin-created owner profile on an existing user (api.md §8.5). */
export async function createOwner(scope: ActorScope, body: z.infer<typeof createOwnerBody>): Promise<OwnerDto> {
  const user = await prisma().user.findFirst({ where: { id: body.userId, deletedAt: null }, select: { id: true, ownerProfile: { select: { id: true } } } });
  if (!user) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown user', { fieldErrors: { userId: ['unknown user'] }, formErrors: [] });
  if (user.ownerProfile) throw new ConflictError('CONFLICT', 'User already has an owner profile');
  const id = newId();
  await prisma().$transaction(async (tx) => {
    await tx.ownerProfile.create({ data: { id, userId: body.userId, ownerType: body.ownerType, businessNameEn: body.businessNameEn ?? null, businessNameAr: body.businessNameAr ?? null, crNumber: body.crNumber ?? null, onboardingStatus: 'DRAFT' } });
    await writeAudit({ ...audit(scope), action: 'owner.created', entityType: 'owner_profile', entityId: id, severity: 'NOTICE', afterValue: { userId: body.userId, ownerType: body.ownerType, createdBy: 'staff' } }, tx);
  });
  await ensureRole(body.userId, 'VEHICLE_OWNER', scope.actor.userId);
  return getOwner(scope, id);
}

/**
 * POST /admin/vendors — UniGate adds a third-party vendor: account + owner profile + the verticals
 * applied for, in one transaction. The activation link is delivered to the vendor (email, else SMS)
 * and shown once to the admin as a fallback; the vendor signs in, uploads documents; the profile enters the review queue
 * by itself when every mandatory document is in (`onOwnerDocumentsChanged`).
 */
export async function createVendor(scope: ActorScope, body: z.infer<typeof createVendorBody>): Promise<VendorCreatedDto> {
  const ownerId = newId();
  const { userId, activationToken, expiresAt } = await prisma().$transaction(async (tx) => {
    const account = await createVendorAccount(scope, { email: body.email, phoneE164: body.phoneE164, fullNameEn: body.fullNameEn, fullNameAr: body.fullNameAr, preferredLocale: body.preferredLocale }, tx);
    await tx.ownerProfile.create({ data: { id: ownerId, userId: account.userId, ownerType: body.ownerType, businessNameEn: body.businessNameEn ?? null, businessNameAr: body.businessNameAr ?? null, crNumber: body.crNumber ?? null, onboardingStatus: 'DRAFT' } });
    for (const t of body.transportTypes) await tx.ownerVerticalApproval.create({ data: { id: newId(), ownerProfileId: ownerId, transportType: t, status: 'NOT_APPLIED' } });
    await writeAudit({ ...audit(scope), action: 'owner.created', entityType: 'owner_profile', entityId: ownerId, severity: 'NOTICE', afterValue: { userId: account.userId, ownerType: body.ownerType, transportTypes: body.transportTypes, createdBy: 'staff', vendor: true } }, tx);
    await publishEvent('owner', ownerId, 'owner.vendor_created', { userId: account.userId, transportTypes: body.transportTypes }, tx);
    return account;
  });
  const url = activationUrl(body.preferredLocale, activationToken);
  // The one-time link never enters the outbox (redacted) or a queue: delivered synchronously, stored masked.
  const delivery = await sendSecretLink({ userId, templateCode: 'VENDOR_ACTIVATION', variables: { companyName: body.businessNameEn ?? body.fullNameEn, expiresAt: expiresAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' }, secrets: { activationUrl: url } });
  return { user: await getUser(scope, userId), owner: await getOwner(scope, ownerId), activationUrl: url, activationExpiresAt: expiresAt.toISOString(), activationDelivery: delivery };
}

const systemScope: AnyScope = { kind: 'SYSTEM', jobName: 'owners.documents', requestId: 'internal' };

/**
 * Called after a document lands on an owner (or on the individual behind one): once every mandatory
 * document is uploaded, DRAFT / REJECTED → DOCUMENTS_SUBMITTED and the admin queue is notified.
 * Verification and approval stay with staff (`approveOwner` requires VERIFIED).
 */
export async function onOwnerDocumentsChanged(ownerProfileId: string | null, userId: string | null = null): Promise<void> {
  const o = ownerProfileId ? await repo.findOwner(systemScope, ownerProfileId) : userId ? await prisma().ownerProfile.findFirst({ where: { userId }, select: { id: true } }).then((r) => (r ? repo.findOwner(systemScope, r.id) : null)) : null;
  if (!o || !['DRAFT', 'REJECTED'].includes(o.onboardingStatus)) return;
  const verticals = appliedVerticals(o);
  const ownerDocs = await mandatoryDocumentsSatisfied('OWNER', o.id, verticals, 'UPLOADED');
  const identityDocs = o.ownerType === 'INDIVIDUAL' ? await mandatoryDocumentsSatisfied('USER', o.userId, verticals, 'UPLOADED') : { ok: true, missing: [] as string[] };
  if (!ownerDocs.ok || !identityDocs.ok) return;
  await prisma().$transaction(async (tx) => {
    await tx.ownerProfile.update({ where: { id: o.id }, data: { onboardingStatus: 'DOCUMENTS_SUBMITTED', rejectionReason: null } });
    for (const t of verticals) {
      await tx.ownerVerticalApproval.upsert({ where: { ownerProfileId_transportType: { ownerProfileId: o.id, transportType: t } }, create: { id: newId(), ownerProfileId: o.id, transportType: t, status: 'UNDER_REVIEW' }, update: { status: 'UNDER_REVIEW' } });
    }
    await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'owner.documents_submitted', entityType: 'owner_profile', entityId: o.id, beforeValue: { onboardingStatus: o.onboardingStatus }, afterValue: { onboardingStatus: 'DOCUMENTS_SUBMITTED', verticals } }, tx);
    await publishEvent('owner', o.id, 'owner.documents_submitted', { verticals, userId: o.userId }, tx);
  });
}

const REVIEW_TRIGGER_FIELDS = ['ownerType', 'businessNameEn', 'businessNameAr', 'crNumber', 'vatNumber', 'isVatRegistered', 'nationalId'] as const;

export async function patchOwner(scope: ActorScope, id: string, body: z.infer<typeof patchOwnerBody>): Promise<OwnerDto> {
  const before = await repo.findOwner(scope, id);
  if (!before) throw new NotFoundError();
  if (before.onboardingStatus === 'SUSPENDED' && scope.kind !== 'GLOBAL') throw new BusinessRuleError('OWNER_NOT_APPROVED', 'A suspended owner cannot edit their profile');
  const touchesIdentity = REVIEW_TRIGGER_FIELDS.some((f) => body[f] !== undefined);
  // Editing identity after approval moves the profile back to review (api.md §8.5).
  const reReview = touchesIdentity && before.onboardingStatus === 'APPROVED';
  const privacy = body.privacySettings ? { ...parsePrivacy(before.privacySettings), ...body.privacySettings } : undefined;

  await prisma().$transaction(async (tx) => {
    await tx.ownerProfile.update({
      where: { id },
      data: {
        ...(body.ownerType ? { ownerType: body.ownerType } : {}),
        ...(body.businessNameEn !== undefined ? { businessNameEn: body.businessNameEn } : {}),
        ...(body.businessNameAr !== undefined ? { businessNameAr: body.businessNameAr } : {}),
        ...(body.crNumber !== undefined ? { crNumber: body.crNumber } : {}),
        ...(body.vatNumber !== undefined ? { vatNumber: body.vatNumber, vatVerifiedAt: null } : {}),
        ...(body.isVatRegistered !== undefined ? { isVatRegistered: body.isVatRegistered } : {}),
        ...(body.nationalId ? { nationalIdEncrypted: encryptPii(body.nationalId), nationalIdLast4: last4(body.nationalId), nationalIdBlindIndex: blindIndex(body.nationalId) } : {}),
        ...(privacy ? { privacySettings: privacy } : {}),
        ...(reReview ? { onboardingStatus: 'UNDER_REVIEW' } : {}),
      },
    });
    if (body.transportTypes) {
      for (const t of body.transportTypes) {
        await tx.ownerVerticalApproval.upsert({ where: { ownerProfileId_transportType: { ownerProfileId: id, transportType: t } }, create: { id: newId(), ownerProfileId: id, transportType: t, status: 'NOT_APPLIED' }, update: {} });
      }
    }
    const { nationalId, ...safeBody } = body;
    await writeAudit({
      ...audit(scope), action: 'owner.updated', entityType: 'owner_profile', entityId: id, severity: reReview ? 'NOTICE' : 'INFO',
      beforeValue: { ownerType: before.ownerType, businessNameEn: before.businessNameEn, crNumber: before.crNumber, vatNumber: before.vatNumber, onboardingStatus: before.onboardingStatus },
      afterValue: { ...safeBody, nationalIdChanged: Boolean(nationalId), onboardingStatus: reReview ? 'UNDER_REVIEW' : before.onboardingStatus },
      changedFields: Object.keys(body),
    }, tx);
  });
  return getOwner(scope, id);
}

function appliedVerticals(o: repo.OwnerRow): TransportType[] {
  const applied = o.verticalApprovals.filter((v) => v.status !== 'REJECTED').map((v) => v.transportType);
  return applied.length ? applied : ['PASSENGER'];
}

/** DRAFT / DOCUMENTS_SUBMITTED / REJECTED → UNDER_REVIEW once every mandatory document is uploaded (staff verify each during review; approval needs them VERIFIED). */
export async function submitForReview(scope: ActorScope, id: string): Promise<OwnerDto> {
  const o = await repo.findOwner(scope, id);
  if (!o) throw new NotFoundError();
  if (!['DRAFT', 'DOCUMENTS_SUBMITTED', 'REJECTED'].includes(o.onboardingStatus)) {
    throw new BusinessRuleError('OWNER_NOT_APPROVED', `Cannot submit a profile in status ${o.onboardingStatus}`, { onboardingStatus: o.onboardingStatus });
  }
  const verticals = appliedVerticals(o);
  const ownerDocs = await mandatoryDocumentsSatisfied('OWNER', id, verticals, 'UPLOADED');
  const identityDocs = o.ownerType === 'INDIVIDUAL' ? await mandatoryDocumentsSatisfied('USER', o.userId, verticals, 'UPLOADED') : { ok: true, missing: [] as string[] };
  const missing = [...ownerDocs.missing, ...identityDocs.missing];
  if (missing.length) throw new BusinessRuleError('OWNER_DOCUMENTS_INCOMPLETE', 'Mandatory documents are missing', { missing });
  await prisma().$transaction(async (tx) => {
    await tx.ownerProfile.update({ where: { id }, data: { onboardingStatus: 'UNDER_REVIEW', rejectionReason: null } });
    for (const t of verticals) {
      await tx.ownerVerticalApproval.upsert({ where: { ownerProfileId_transportType: { ownerProfileId: id, transportType: t } }, create: { id: newId(), ownerProfileId: id, transportType: t, status: 'UNDER_REVIEW' }, update: { status: 'UNDER_REVIEW' } });
    }
    await writeAudit({ ...audit(scope), action: 'owner.submitted_for_review', entityType: 'owner_profile', entityId: id, beforeValue: { onboardingStatus: o.onboardingStatus }, afterValue: { onboardingStatus: 'UNDER_REVIEW', verticals } }, tx);
    await publishEvent('owner', id, 'owner.submitted_for_review', { verticals }, tx);
  });
  return getOwner(scope, id);
}

export async function approveOwner(scope: ActorScope, id: string, notes?: string): Promise<OwnerDto> {
  const o = await repo.findOwner(scope, id);
  if (!o) throw new NotFoundError();
  if (!['UNDER_REVIEW', 'DOCUMENTS_SUBMITTED'].includes(o.onboardingStatus)) {
    throw new BusinessRuleError('OWNER_NOT_APPROVED', `Only a profile under review can be approved (current: ${o.onboardingStatus})`, { onboardingStatus: o.onboardingStatus });
  }
  // The reviewer verifies every mandatory document before the profile is approved (vehicles can only be registered after this).
  const verticals = appliedVerticals(o);
  const ownerDocs = await mandatoryDocumentsSatisfied('OWNER', id, verticals, 'VERIFIED');
  const identityDocs = o.ownerType === 'INDIVIDUAL' ? await mandatoryDocumentsSatisfied('USER', o.userId, verticals, 'VERIFIED') : { ok: true, missing: [] as string[] };
  const unverified = [...ownerDocs.missing, ...identityDocs.missing];
  if (unverified.length) throw new BusinessRuleError('OWNER_DOCUMENTS_INCOMPLETE', 'Every mandatory document must be verified before approval', { missing: unverified });
  await prisma().$transaction(async (tx) => {
    await tx.ownerProfile.update({ where: { id }, data: { onboardingStatus: 'APPROVED', approvedByUserId: scope.actor.userId, approvedAt: new Date(), rejectionReason: null } });
    for (const t of verticals) {
      await tx.ownerVerticalApproval.upsert({
        where: { ownerProfileId_transportType: { ownerProfileId: id, transportType: t } },
        create: { id: newId(), ownerProfileId: id, transportType: t, status: 'APPROVED', approvedByUserId: scope.actor.userId, approvedAt: new Date(), notes: notes ?? null },
        update: { status: 'APPROVED', approvedByUserId: scope.actor.userId, approvedAt: new Date(), notes: notes ?? null },
      });
    }
    await writeAudit({ ...audit(scope), action: 'owner.approved', entityType: 'owner_profile', entityId: id, severity: 'NOTICE', beforeValue: { onboardingStatus: o.onboardingStatus }, afterValue: { onboardingStatus: 'APPROVED', verticals, notes: notes ?? null } }, tx);
    await publishEvent('owner', id, 'owner.approved', { userId: o.userId, verticals }, tx);
  });
  await ensureRole(o.userId, 'VEHICLE_OWNER', scope.actor.userId);
  return getOwner(scope, id);
}

export async function rejectOwner(scope: ActorScope, id: string, rejectionReason: string): Promise<OwnerDto> {
  const o = await repo.findOwner(scope, id);
  if (!o) throw new NotFoundError();
  if (o.onboardingStatus === 'APPROVED' || o.onboardingStatus === 'SUSPENDED') {
    throw new BusinessRuleError('OWNER_NOT_APPROVED', `Cannot reject a profile in status ${o.onboardingStatus}; suspend it instead`, { onboardingStatus: o.onboardingStatus });
  }
  await prisma().$transaction(async (tx) => {
    await tx.ownerProfile.update({ where: { id }, data: { onboardingStatus: 'REJECTED', rejectionReason } });
    await tx.ownerVerticalApproval.updateMany({ where: { ownerProfileId: id, status: 'UNDER_REVIEW' }, data: { status: 'REJECTED', notes: rejectionReason } });
    await writeAudit({ ...audit(scope), action: 'owner.rejected', entityType: 'owner_profile', entityId: id, severity: 'NOTICE', beforeValue: { onboardingStatus: o.onboardingStatus }, afterValue: { onboardingStatus: 'REJECTED', rejectionReason } }, tx);
    await publishEvent('owner', id, 'owner.rejected', { userId: o.userId, rejectionReason }, tx);
  });
  return getOwner(scope, id);
}

/** → SUSPENDED. Vehicles become non-dispatchable through the owner-status predicate; live bookings are untouched. */
export async function suspendOwner(scope: ActorScope, id: string, reason: string): Promise<OwnerDto> {
  const o = await repo.findOwner(scope, id);
  if (!o) throw new NotFoundError();
  if (o.isPlatformFleet) throw new BusinessRuleError('VALIDATION_FAILED', 'The platform fleet owner cannot be suspended', { fieldErrors: {}, formErrors: ['platform fleet'] });
  await prisma().$transaction(async (tx) => {
    await tx.ownerProfile.update({ where: { id }, data: { onboardingStatus: 'SUSPENDED', rejectionReason: reason } });
    await tx.ownerVerticalApproval.updateMany({ where: { ownerProfileId: id, status: 'APPROVED' }, data: { status: 'SUSPENDED', notes: reason } });
    await tx.vehicle.updateMany({ where: { ownerProfileId: id, lifecycleStatus: 'ACTIVE' }, data: { lifecycleStatus: 'SUSPENDED' } });
    await writeAudit({ ...audit(scope), action: 'owner.suspended', entityType: 'owner_profile', entityId: id, severity: 'NOTICE', beforeValue: { onboardingStatus: o.onboardingStatus }, afterValue: { onboardingStatus: 'SUSPENDED', reason } }, tx);
    await publishEvent('owner', id, 'owner.suspended', { userId: o.userId, reason }, tx);
  });
  return getOwner(scope, id);
}

export async function setServiceAreas(scope: ActorScope, id: string, cityIds: string[]): Promise<OwnerDto> {
  const o = await repo.findOwner(scope, id);
  if (!o) throw new NotFoundError();
  const unique = [...new Set(cityIds)];
  const known = await prisma().city.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true } });
  const unknown = unique.filter((c) => !known.some((k) => k.id === c));
  if (unknown.length) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or inactive cities', { fieldErrors: { cityIds: unknown }, formErrors: [] });
  await prisma().$transaction(async (tx) => {
    await tx.ownerServiceArea.deleteMany({ where: { ownerProfileId: id } });
    await tx.ownerServiceArea.createMany({ data: unique.map((cityId) => ({ ownerProfileId: id, cityId })) });
    await writeAudit({ ...audit(scope), action: 'owner.service_areas_replaced', entityType: 'owner_profile', entityId: id, beforeValue: { cityIds: o.serviceAreas.map((s) => s.cityId) }, afterValue: { cityIds: unique } }, tx);
    await publishEvent('owner', id, 'owner.service_areas_replaced', { cityIds: unique }, tx);
  });
  return getOwner(scope, id);
}

export async function listBankAccounts(scope: AnyScope, ownerProfileId: string): Promise<OwnerBankAccountDto[]> {
  const rows = await repo.listBankAccounts(scope, ownerProfileId);
  if (!rows) throw new NotFoundError();
  return rows.map(toBankAccountDto);
}

/**
 * Adding a payout account is step-up protected at the route and cool-off protected here:
 * `activation_at` = now + `settlement.bank_account_cooloff_hours` (A-47) so a redirected
 * payout can be caught before money moves.
 */
export async function addBankAccount(scope: ActorScope, ownerProfileId: string, body: z.infer<typeof createBankAccountBody>): Promise<OwnerBankAccountDto> {
  const owner = await repo.findOwner(scope, ownerProfileId);
  if (!owner) throw new NotFoundError();
  const iban = body.iban.replace(/\s+/g, '').toUpperCase();
  const index = blindIndex(iban);
  const dup = await prisma().ownerBankAccount.findFirst({ where: { ownerProfileId, ibanBlindIndex: index, deletedAt: null }, select: { id: true } });
  if (dup) throw new ConflictError('CONFLICT', 'This IBAN is already registered on the profile');
  const coolOffHours = await getSettingValue<number>('settlement.bank_account_cooloff_hours', 72);
  const existing = await prisma().ownerBankAccount.count({ where: { ownerProfileId, deletedAt: null } });
  const makeDefault = body.makeDefault || existing === 0;
  const id = newId();
  const activationAt = new Date(Date.now() + coolOffHours * 3_600_000);
  await prisma().$transaction(async (tx) => {
    if (makeDefault) await tx.ownerBankAccount.updateMany({ where: { ownerProfileId, isDefault: true }, data: { isDefault: false } });
    await tx.ownerBankAccount.create({
      data: { id, ownerProfileId, accountHolderName: body.accountHolderName, bankName: body.bankName, ibanEncrypted: encryptPii(iban), ibanLast4: last4(iban), ibanBlindIndex: index, isDefault: makeDefault, activationAt, changedByUserId: scope.actor.userId },
    });
    if (makeDefault) await tx.ownerProfile.update({ where: { id: ownerProfileId }, data: { defaultPayoutAccountId: id } });
    await writeAudit({ ...audit(scope), action: 'owner.bank_account_added', entityType: 'owner_bank_account', entityId: id, severity: 'SECURITY', afterValue: { ownerProfileId, bankName: body.bankName, ibanLast4: last4(iban), isDefault: makeDefault, activationAt: activationAt.toISOString() } }, tx);
    await publishEvent('owner', ownerProfileId, 'owner.bank_account_added', { bankAccountId: id, ibanLast4: last4(iban), activationAt: activationAt.toISOString() }, tx);
  });
  const row = await prisma().ownerBankAccount.findUniqueOrThrow({ where: { id }, select: repo.bankAccountSelect });
  return toBankAccountDto(row);
}

export interface PayoutAccount {
  id: string;
  bankName: string;
  accountHolderName: string;
  ibanLast4: string;
  isVerified: boolean;
  isDefault: boolean;
  /** Cool-off end (A-47): a payout before this instant is refused. */
  activationAt: Date;
}

/** The owner's payout account for settlements: the requested one, else the default. Deleted accounts never qualify. */
export async function payoutAccountOf(_scope: AnyScope, ownerProfileId: string, bankAccountId: string | null = null): Promise<PayoutAccount | null> {
  const row = await prisma().ownerBankAccount.findFirst({ where: { ownerProfileId, deletedAt: null, ...(bankAccountId ? { id: bankAccountId } : { isDefault: true }) }, select: { id: true, bankName: true, accountHolderName: true, ibanLast4: true, isVerified: true, isDefault: true, activationAt: true } });
  return row;
}

/** VAT registration as the finance module needs it (deemed-supplier vs owner-is-supplier). */
export async function ownerVatStatusOf(_scope: AnyScope, ownerProfileId: string): Promise<{ isVatRegistered: boolean; vatNumber: string | null; displayName: string; isPlatformFleet: boolean } | null> {
  const o = await prisma().ownerProfile.findUnique({ where: { id: ownerProfileId }, select: { isVatRegistered: true, vatNumber: true, isPlatformFleet: true, businessNameEn: true, user: { select: { fullNameEn: true } } } });
  if (!o) return null;
  return { isVatRegistered: o.isVatRegistered, vatNumber: o.vatNumber, displayName: o.businessNameEn ?? o.user.fullNameEn, isPlatformFleet: o.isPlatformFleet };
}

/** The single platform-fleet owner row (A-57): UniGate's own vehicles hang off it. */
export async function platformFleetOwnerId(_scope: AnyScope): Promise<string | null> {
  const o = await prisma().ownerProfile.findFirst({ where: { isPlatformFleet: true }, select: { id: true } });
  return o?.id ?? null;
}
