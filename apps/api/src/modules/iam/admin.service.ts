import type { ActorScope, AnyScope, PermissionDto, RoleDto, UserAdminDto } from '@unigate/types';
import type { createRoleBody, createUserBody, patchUserBody, updateRoleBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { hashPassword, normaliseIdentifier, randomToken, sha256Hex } from '@/common/crypto.js';
import { newId } from '@/common/ids.js';
import { prisma } from '@/database/prisma.js';
import { publishEvent } from '@/events/outbox.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { toPermissionDto, toRoleDto, toUserAdminDto } from './iam.mapper.js';
import { bumpPermissionVersion, bumpPermissionVersionForRole } from './permission.service.js';
import * as sessions from './session.repository.js';
import * as users from './user.repository.js';

/** Administrative user and role management (api.md §8.3 and roles). All routes are GLOBAL scope. */

const roleSelect = {
  id: true, code: true, nameEn: true, nameAr: true, description: true, isSystem: true, createdAt: true, updatedAt: true,
  rolePermissions: { select: { permission: { select: { code: true } } } },
} as const;

export async function listUsers(scope: AnyScope, filters: { status?: string | undefined; roleCode?: string | undefined; q?: string | undefined }, page: { page: number; pageSize: number }) {
  const { items, total } = await users.listUsers(scope, filters, page);
  return { items: items.map(toUserAdminDto), total };
}

export async function getUser(scope: AnyScope, id: string): Promise<UserAdminDto> {
  const u = await users.findUserById(scope, id);
  if (!u) throw new NotFoundError();
  return toUserAdminDto(u);
}

/** Staff/platform user: no password is set; an activation (reset) link is sent (api.md §8.3). */
export async function createUser(scope: ActorScope, body: z.infer<typeof createUserBody>): Promise<UserAdminDto> {
  const email = normaliseIdentifier(body.email);
  const phone = body.phoneE164 ? normaliseIdentifier(body.phoneE164) : null;
  if (await users.identifierTaken(scope, { email, phoneE164: phone })) throw new ConflictError('AUTH_IDENTIFIER_TAKEN', 'Email or phone already in use');
  const roles = await prisma().role.findMany({ where: { code: { in: body.roleCodes } }, select: { id: true, code: true } });
  const missing = body.roleCodes.filter((c) => !roles.some((r) => r.code === c));
  if (missing.length) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown role codes', { fieldErrors: { roleCodes: missing.map((m) => `unknown role ${m}`) }, formErrors: [] });

  const id = newId();
  const activationToken = randomToken(32);
  await prisma().$transaction(async (tx) => {
    await tx.user.create({
      data: { id, email, phoneE164: phone, emailVerifiedAt: null, fullNameEn: body.fullNameEn, fullNameAr: body.fullNameAr ?? null, status: 'ACTIVE', preferredLocale: body.preferredLocale },
    });
    await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id, grantedBy: scope.actor.userId })) });
    await tx.passwordResetToken.create({ data: { id: newId(), userId: id, tokenHash: sha256Hex(activationToken), expiresAt: new Date(Date.now() + 72 * 3_600_000) } });
    await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'user.created', entityType: 'user', entityId: id, severity: 'NOTICE', afterValue: { email, roleCodes: body.roleCodes } }, tx);
    await publishEvent('user', id, 'auth.password_reset_requested', { activation: true, locale: body.preferredLocale }, tx);
  });
  return getUser(scope, id);
}

export async function patchUser(scope: ActorScope, id: string, body: z.infer<typeof patchUserBody>): Promise<UserAdminDto> {
  const before = await users.findUserById(scope, id);
  if (!before) throw new NotFoundError();
  await prisma().user.update({
    where: { id },
    data: {
      ...(body.fullNameEn !== undefined ? { fullNameEn: body.fullNameEn } : {}),
      ...(body.fullNameAr !== undefined ? { fullNameAr: body.fullNameAr } : {}),
      ...(body.preferredLocale !== undefined ? { preferredLocale: body.preferredLocale } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    },
  });
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'user.updated', entityType: 'user', entityId: id, beforeValue: { fullNameEn: before.fullNameEn, fullNameAr: before.fullNameAr, preferredLocale: before.preferredLocale, timezone: before.timezone }, afterValue: { ...body }, changedFields: Object.keys(body) });
  return getUser(scope, id);
}

export async function suspendUser(scope: ActorScope, id: string, reason: string, suspend: boolean): Promise<UserAdminDto> {
  if (id === scope.actor.userId) throw new BusinessRuleError('PERM_SELF_MODIFICATION', 'You cannot suspend your own account');
  const target = await users.findUserById(scope, id);
  if (!target) throw new NotFoundError();
  await prisma().user.update({ where: { id }, data: { status: suspend ? 'SUSPENDED' : 'ACTIVE' } });
  if (suspend) await sessions.revokeAllSessions(scope, id, 'ADMIN_SUSPENDED');
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: suspend ? 'user.suspended' : 'user.reactivated', entityType: 'user', entityId: id, severity: 'SECURITY', beforeValue: { status: target.status }, afterValue: { status: suspend ? 'SUSPENDED' : 'ACTIVE', reason } });
  return getUser(scope, id);
}

export async function deleteUser(scope: ActorScope, id: string): Promise<void> {
  if (id === scope.actor.userId) throw new BusinessRuleError('PERM_SELF_MODIFICATION', 'You cannot delete your own account');
  const target = await users.findUserById(scope, id);
  if (!target) throw new NotFoundError();
  // "Blocked if the user has active bookings or trips" — those tables exist; the predicate is
  // wired when bookings land (Phase 8). Until then, only the self-check and sessions apply.
  await prisma().$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { deletedAt: new Date(), status: 'DEACTIVATED' } });
    await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'user.deleted', entityType: 'user', entityId: id, severity: 'SECURITY' }, tx);
  });
  await sessions.revokeAllSessions(scope, id, 'ADMIN_DELETED');
}

/** PUT /users/{id}/roles — replaces the role set; bumps permission_version; audited NOTICE. */
export async function setUserRoles(scope: ActorScope, id: string, roleCodes: string[]): Promise<UserAdminDto> {
  if (id === scope.actor.userId) throw new BusinessRuleError('PERM_SELF_MODIFICATION', 'You cannot change your own roles');
  const target = await users.findUserById(scope, id);
  if (!target) throw new NotFoundError();
  const roles = await prisma().role.findMany({ where: { code: { in: roleCodes } }, select: { id: true, code: true } });
  const missing = roleCodes.filter((c) => !roles.some((r) => r.code === c));
  if (missing.length) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown role codes', { fieldErrors: { roleCodes: missing.map((m) => `unknown role ${m}`) }, formErrors: [] });
  const before = target.userRoles.map((r) => r.role.code).sort();
  await prisma().$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.userRole.createMany({ data: roles.map((r) => ({ userId: id, roleId: r.id, grantedBy: scope.actor.userId })) });
    await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'user.roles_changed', entityType: 'user', entityId: id, severity: 'NOTICE', beforeValue: { roles: before }, afterValue: { roles: [...roleCodes].sort() }, changedFields: ['roles'] }, tx);
    await publishEvent('user', id, 'user.roles_changed', { before, after: roleCodes }, tx);
  });
  await bumpPermissionVersion(id);
  return getUser(scope, id);
}

// ── roles & permissions ──────────────────────────────────────────────────────

export async function listRoles(): Promise<RoleDto[]> {
  const rows = await prisma().role.findMany({ select: roleSelect, orderBy: { code: 'asc' } });
  return rows.map(toRoleDto);
}

export async function listPermissions(): Promise<PermissionDto[]> {
  const rows = await prisma().permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] });
  return rows.map(toPermissionDto);
}

/** New roles need no code change (architecture.md §6.1) — an admin action, not a deployment. */
export async function createRole(scope: ActorScope, body: z.infer<typeof createRoleBody>): Promise<RoleDto> {
  const exists = await prisma().role.findUnique({ where: { code: body.code }, select: { id: true } });
  if (exists) throw new ConflictError('CONFLICT', `Role ${body.code} already exists`);
  const perms = await resolvePermissionIds(body.permissionCodes);
  const role = await prisma().$transaction(async (tx) => {
    const r = await tx.role.create({ data: { id: newId(), code: body.code, nameEn: body.nameEn, nameAr: body.nameAr, description: body.description ?? null, isSystem: false } });
    if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: r.id, permissionId: p.id })) });
    await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'role.created', entityType: 'role', entityId: r.code, severity: 'NOTICE', afterValue: { ...body } }, tx);
    return r;
  });
  const row = await prisma().role.findUniqueOrThrow({ where: { id: role.id }, select: roleSelect });
  return toRoleDto(row);
}

export async function updateRole(scope: ActorScope, code: string, body: z.infer<typeof updateRoleBody>): Promise<RoleDto> {
  const role = await prisma().role.findUnique({ where: { code }, select: roleSelect });
  if (!role) throw new NotFoundError();
  if (role.isSystem) throw new ConflictError('PERM_ROLE_IMMUTABLE', 'System roles cannot be edited');
  const perms = body.permissionCodes ? await resolvePermissionIds(body.permissionCodes) : null;
  await prisma().$transaction(async (tx) => {
    await tx.role.update({ where: { id: role.id }, data: { ...(body.nameEn ? { nameEn: body.nameEn } : {}), ...(body.nameAr ? { nameAr: body.nameAr } : {}), ...(body.description !== undefined ? { description: body.description } : {}) } });
    if (perms) {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (perms.length) await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
    }
    await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'role.updated', entityType: 'role', entityId: code, severity: 'NOTICE', beforeValue: { permissionCodes: role.rolePermissions.map((p) => p.permission.code) }, afterValue: { ...body } }, tx);
  });
  if (perms) await bumpPermissionVersionForRole(role.id);
  const row = await prisma().role.findUniqueOrThrow({ where: { id: role.id }, select: roleSelect });
  return toRoleDto(row);
}

export async function deleteRole(scope: ActorScope, code: string): Promise<void> {
  const role = await prisma().role.findUnique({ where: { code }, select: { id: true, isSystem: true, _count: { select: { userRoles: true } } } });
  if (!role) throw new NotFoundError();
  if (role.isSystem) throw new ConflictError('PERM_ROLE_IMMUTABLE', 'System roles cannot be deleted');
  if (role._count.userRoles > 0) throw new ConflictError('CONFLICT', 'Role is still assigned to users');
  await prisma().role.delete({ where: { id: role.id } });
  await writeAudit({ actorUserId: scope.actor.userId, actorType: 'USER', actorRoles: [...scope.actor.roles], action: 'role.deleted', entityType: 'role', entityId: code, severity: 'NOTICE' });
}

async function resolvePermissionIds(codes: string[]): Promise<{ id: string }[]> {
  const rows = await prisma().permission.findMany({ where: { code: { in: codes }, isAssignable: true }, select: { id: true, code: true } });
  const missing = codes.filter((c) => !rows.some((r) => r.code === c));
  if (missing.length) throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown or unassignable permission codes', { fieldErrors: { permissionCodes: missing }, formErrors: [] });
  return rows;
}

/** Used by the seed-free "first production admin" CLI (Phase 3 exit item). */
export async function createInitialAdmin(email: string, password: string): Promise<string> {
  const scope: AnyScope = { kind: 'SYSTEM', jobName: 'cli.create-admin', requestId: 'cli' };
  if (await users.identifierTaken(scope, { email })) throw new ConflictError('AUTH_IDENTIFIER_TAKEN', 'Email already in use');
  const role = await prisma().role.findUniqueOrThrow({ where: { code: 'SUPER_ADMIN' }, select: { id: true } });
  const id = newId();
  await prisma().user.create({
    data: { id, email: normaliseIdentifier(email), emailVerifiedAt: new Date(), passwordHash: await hashPassword(password), passwordChangedAt: new Date(0), fullNameEn: 'Platform Administrator', status: 'ACTIVE', preferredLocale: 'en', userRoles: { create: { roleId: role.id } } },
  });
  return id;
}

/** Cross-module session revocation (e.g. a driver deactivated by their owner). Repositories stay module-private. */
export async function revokeSessionsOf(scope: AnyScope, userId: string, reason: string): Promise<number> {
  return sessions.revokeAllSessions(scope, userId, reason);
}
