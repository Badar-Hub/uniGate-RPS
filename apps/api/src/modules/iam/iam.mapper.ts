import type { MeDto, PermissionDto, ProfileSummaryDto, RoleDto, SessionDto, UserAdminDto } from '@unigate/types';
import type { UserWithProfiles } from './user.repository.js';

/**
 * Explicit allow-lists — never a spread (security.md T-07). There is no field here for
 * password_hash, token hashes or any *_encrypted column, so they cannot leak through a join.
 */
function profiles(u: UserWithProfiles): ProfileSummaryDto {
  return {
    customer: u.customerProfile ? { id: u.customerProfile.id, customerType: u.customerProfile.customerType } : null,
    owner: u.ownerProfile
      ? { id: u.ownerProfile.id, onboardingStatus: u.ownerProfile.onboardingStatus, isPlatformFleet: u.ownerProfile.isPlatformFleet }
      : null,
    driver: u.driverProfile ? { id: u.driverProfile.id, approvalStatus: u.driverProfile.approvalStatus } : null,
    spo: u.spoProfile ? { id: u.spoProfile.id, employeeCode: u.spoProfile.employeeCode } : null,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toMeDto(u: UserWithProfiles, permissions: ReadonlySet<string>): MeDto {
  return {
    id: u.id,
    email: u.email,
    emailVerifiedAt: iso(u.emailVerifiedAt),
    phoneE164: u.phoneE164,
    phoneVerifiedAt: iso(u.phoneVerifiedAt),
    fullNameEn: u.fullNameEn,
    fullNameAr: u.fullNameAr,
    status: u.status,
    preferredLocale: u.preferredLocale === 'en' ? 'en' : 'ar',
    timezone: u.timezone,
    roles: u.userRoles.map((r) => r.role.code).sort(),
    permissions: [...permissions].sort(),
    permissionVersion: u.permissionVersion,
    profiles: profiles(u),
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
  };
}

export function toUserAdminDto(u: UserWithProfiles): UserAdminDto {
  return {
    id: u.id,
    email: u.email,
    emailVerifiedAt: iso(u.emailVerifiedAt),
    phoneE164: u.phoneE164,
    phoneVerifiedAt: iso(u.phoneVerifiedAt),
    fullNameEn: u.fullNameEn,
    fullNameAr: u.fullNameAr,
    status: u.status,
    preferredLocale: u.preferredLocale === 'en' ? 'en' : 'ar',
    timezone: u.timezone,
    roles: u.userRoles.map((r) => r.role.code).sort(),
    permissionVersion: u.permissionVersion,
    profiles: profiles(u),
    lastLoginAt: iso(u.lastLoginAt),
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    deletedAt: iso(u.deletedAt),
  };
}

export function toSessionDto(
  s: { id: string; deviceName: string | null; clientType: 'WEB' | 'IOS' | 'ANDROID'; ipAddress: string | null; createdAt: Date; lastSeenAt: Date },
  currentSessionId: string | null,
): SessionDto {
  return {
    id: s.id,
    deviceName: s.deviceName,
    clientType: s.clientType,
    ipAddress: s.ipAddress,
    createdAt: s.createdAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    isCurrent: s.id === currentSessionId,
  };
}

export function toRoleDto(r: {
  code: string; nameEn: string; nameAr: string; description: string | null; isSystem: boolean; createdAt: Date; updatedAt: Date;
  rolePermissions: { permission: { code: string } }[];
}): RoleDto {
  return {
    code: r.code,
    nameEn: r.nameEn,
    nameAr: r.nameAr,
    description: r.description,
    isSystem: r.isSystem,
    permissionCodes: r.rolePermissions.map((p) => p.permission.code).sort(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function toPermissionDto(p: { code: string; module: string; descriptionEn: string; descriptionAr: string; isAssignable: boolean }): PermissionDto {
  return { code: p.code, module: p.module, descriptionEn: p.descriptionEn, descriptionAr: p.descriptionAr, isAssignable: p.isAssignable };
}
