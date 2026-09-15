import type {
  CorporateCustomerDto,
  CustomerDto,
  DriverAssignmentDto,
  DriverDto,
  NationalAddressDto,
  OwnerBankAccountDto,
  OwnerDto,
  OwnerPublicDto,
  SavedLocationDto,
  SpoCommissionLineDto,
  SpoCustomerAssignmentDto,
  SpoLeadDto,
  SpoProfileDto,
} from '@unigate/types';
import { ownerPrivacySettings, type OwnerPrivacySettings } from '@unigate/validation';
import { toMoneyString } from '@/common/money.js';
import { maskPhone } from '@/common/redact.js';
import type { CustomerRow } from './customer.repository.js';
import type { DriverRow } from './driver.repository.js';
import type { BankAccountRow, OwnerRow } from './owner.repository.js';
import type { AssignmentRow, CommissionRow, LeadRow, SpoRow } from './spo.repository.js';

/** Every DTO is hand-built; encrypted columns are never selected, so they cannot leak here. */

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** `viewerIsSelfOrPii` = the customer themselves, or a staff member holding the PII reveal code. */
export function toCustomerDto(c: CustomerRow, viewerIsSelfOrPii: boolean): CustomerDto {
  const firstInvoice = c.invoices[0] ?? null;
  return {
    id: c.id,
    userId: c.userId,
    customerType: c.customerType,
    fullNameEn: c.user.fullNameEn,
    fullNameAr: c.user.fullNameAr,
    phoneE164: c.user.phoneE164 ? (viewerIsSelfOrPii ? c.user.phoneE164 : maskPhone(c.user.phoneE164)) : null,
    email: c.user.email,
    userStatus: c.user.status,
    vatNumber: c.vatNumber,
    vatNumberVerifiedAt: iso(c.vatNumberVerifiedAt),
    vatNumberLockedAt: firstInvoice ? firstInvoice.issueDate.toISOString() : null,
    defaultCityId: c.defaultCityId,
    ratingAvg: c.ratingAvg.toFixed(2),
    ratingCount: c.ratingCount,
    totalBookings: c.totalBookings,
    acquiredBySpoId: c.acquiredBySpoId,
    corporate: c.corporate ? toCorporateDto(c.corporate) : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toNationalAddress(c: NonNullable<CustomerRow['corporate']>): NationalAddressDto {
  const a: NationalAddressDto = {
    buildingNumber: c.addressBuildingNumber,
    streetEn: c.addressStreetEn,
    streetAr: c.addressStreetAr,
    districtEn: c.addressDistrictEn,
    districtAr: c.addressDistrictAr,
    cityId: c.addressCityId,
    postalCode: c.addressPostalCode,
    additionalNumber: c.addressAdditionalNumber,
    shortCode: c.addressShortCode,
    isComplete: false,
  };
  a.isComplete = Boolean(a.buildingNumber && a.streetEn && a.districtEn && a.cityId && a.postalCode && a.additionalNumber);
  return a;
}

export function toCorporateDto(c: NonNullable<CustomerRow['corporate']>): CorporateCustomerDto {
  return {
    id: c.id,
    companyNameEn: c.companyNameEn,
    companyNameAr: c.companyNameAr,
    crNumber: c.crNumber,
    nationalAddress: toNationalAddress(c),
    contactPersonName: c.contactPersonName,
    contactPersonPhone: c.contactPersonPhone,
    contactPersonEmail: c.contactPersonEmail,
    creditStatus: c.creditStatus,
    creditLimitAmount: toMoneyString(c.creditLimitAmount),
    creditTermsDays: c.creditTermsDays,
    billingCycle: c.billingCycle,
    invoiceLineGranularity: c.invoiceLineGranularity,
    isVerified: c.isVerified,
    creditApprovedAt: iso(c.creditApprovedAt),
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function parsePrivacy(raw: unknown): OwnerPrivacySettings {
  const parsed = ownerPrivacySettings.safeParse(raw ?? {});
  return parsed.success ? parsed.data : ownerPrivacySettings.parse({});
}

export function toOwnerDto(o: OwnerRow, viewerIsSelfOrPii: boolean): OwnerDto {
  return {
    id: o.id,
    userId: o.userId,
    ownerType: o.ownerType,
    isPlatformFleet: o.isPlatformFleet,
    businessNameEn: o.businessNameEn,
    businessNameAr: o.businessNameAr,
    crNumber: o.crNumber,
    vatNumber: o.vatNumber,
    isVatRegistered: o.isVatRegistered,
    vatVerifiedAt: iso(o.vatVerifiedAt),
    nationalIdLast4: viewerIsSelfOrPii ? o.nationalIdLast4 : null,
    onboardingStatus: o.onboardingStatus,
    approvedAt: iso(o.approvedAt),
    rejectionReason: o.rejectionReason,
    ratingAvg: o.ratingAvg.toFixed(2),
    ratingCount: o.ratingCount,
    privacySettings: parsePrivacy(o.privacySettings),
    verticals: o.verticalApprovals.map((v) => ({ transportType: v.transportType, status: v.status, approvedAt: iso(v.approvedAt), notes: v.notes })),
    serviceAreaCityIds: o.serviceAreas.map((s) => s.cityId),
    fullNameEn: o.user.fullNameEn,
    phoneE164: o.user.phoneE164 ? (viewerIsSelfOrPii ? o.user.phoneE164 : maskPhone(o.user.phoneE164)) : null,
    email: viewerIsSelfOrPii ? o.user.email : null,
    userStatus: o.user.status,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
  };
}

/** Counterparty view — `privacy_settings` decides field by field (FR-PROFILES-06). */
export function toOwnerPublicDto(o: OwnerRow): OwnerPublicDto {
  const p = parsePrivacy(o.privacySettings);
  const business = o.businessNameEn ?? o.businessNameAr;
  return {
    id: o.id,
    displayName: p.showBusinessName && business ? business : o.user.fullNameEn.split(' ')[0] ?? 'Owner',
    ownerType: o.ownerType,
    ratingAvg: p.showRating ? o.ratingAvg.toFixed(2) : null,
    ratingCount: p.showRating ? o.ratingCount : null,
    fleetSize: p.showFleetSize ? o._count.vehicles : null,
    serviceAreaCityIds: p.showCity ? o.serviceAreas.map((s) => s.cityId) : null,
  };
}

export function toBankAccountDto(b: BankAccountRow): OwnerBankAccountDto {
  return { id: b.id, accountHolderName: b.accountHolderName, bankName: b.bankName, ibanLast4: b.ibanLast4, isVerified: b.isVerified, isDefault: b.isDefault, activationAt: b.activationAt.toISOString(), createdAt: b.createdAt.toISOString() };
}

export function toDriverDto(d: DriverRow, viewerIsSelfOrPii: boolean): DriverDto {
  return {
    id: d.id,
    userId: d.userId,
    ownerProfileId: d.ownerProfileId,
    fullNameEn: d.user.fullNameEn,
    fullNameAr: d.user.fullNameAr,
    phoneE164: d.user.phoneE164 ? (viewerIsSelfOrPii ? d.user.phoneE164 : maskPhone(d.user.phoneE164)) : null,
    userStatus: d.user.status,
    idType: d.idType,
    nationalIdLast4: viewerIsSelfOrPii ? d.nationalIdLast4 : null,
    dateOfBirth: viewerIsSelfOrPii ? isoDate(d.dateOfBirth) : null,
    licenseNumberLast4: viewerIsSelfOrPii ? d.licenseNumberLast4 : null,
    licenseExpiryDate: isoDate(d.licenseExpiryDate),
    licenseCategories: d.licenseCategories,
    approvalStatus: d.approvalStatus,
    availabilityStatus: d.availabilityStatus,
    ratingAvg: d.ratingAvg.toFixed(2),
    ratingCount: d.ratingCount,
    emergencyContactName: viewerIsSelfOrPii ? d.emergencyContactName : null,
    emergencyContactPhone: viewerIsSelfOrPii ? d.emergencyContactPhone : null,
    verticals: d.verticalEligibility.map((v) => ({ transportType: v.transportType, status: v.status, approvedAt: iso(v.approvedAt) })),
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

export function toAssignmentDto(a: { id: string; vehicleId: string; assignedFrom: Date; assignedTo: Date | null; assignedByUserId: string | null }): DriverAssignmentDto {
  return { id: a.id, vehicleId: a.vehicleId, assignedAt: a.assignedFrom.toISOString(), unassignedAt: iso(a.assignedTo), assignedByUserId: a.assignedByUserId };
}

export function toSpoProfileDto(s: SpoRow): SpoProfileDto {
  return {
    id: s.id, userId: s.userId, fullNameEn: s.user.fullNameEn, email: s.user.email, employeeCode: s.employeeCode, regionId: s.regionId,
    managerUserId: s.managerUserId, commissionModelId: s.commissionModelId, isActive: s.isActive, activeCustomerCount: s._count.assignments,
    createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
  };
}

export function toSpoAssignmentDto(a: AssignmentRow): SpoCustomerAssignmentDto {
  return { id: a.id, spoProfileId: a.spoProfileId, customerProfileId: a.customerProfileId, customerFullNameEn: a.customerProfile.user.fullNameEn, assignedAt: a.assignedAt.toISOString(), unassignedAt: iso(a.unassignedAt) };
}

export function toSpoLeadDto(l: LeadRow): SpoLeadDto {
  return { id: l.id, spoProfileId: l.spoProfileId, contactName: l.contactName, contactPhone: l.contactPhone, companyName: l.companyName, status: l.status, convertedUserId: l.convertedUserId, notes: l.notes, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString() };
}

export function toSpoCommissionDto(r: CommissionRow): SpoCommissionLineDto {
  const rule = (r.spoRuleSnapshot ?? {}) as { basis?: string };
  return { bookingId: r.bookingId, spoProfileId: r.booking.attributedSpoProfileId ?? '', customerProfileId: r.booking.customerProfileId, amount: toMoneyString(r.spoCommissionAmount), basis: rule.basis ?? 'UNKNOWN', snapshotAt: r.computedAt.toISOString() };
}

export function toSavedLocationDto(l: { id: string; label: string; addressLine: string; cityId: string; latitude: { toNumber(): number }; longitude: { toNumber(): number }; placeId: string | null; createdAt: Date; updatedAt: Date }): SavedLocationDto {
  return { id: l.id, label: l.label, addressLine: l.addressLine, cityId: l.cityId, latitude: l.latitude.toNumber(), longitude: l.longitude.toNumber(), placeId: l.placeId, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString() };
}
