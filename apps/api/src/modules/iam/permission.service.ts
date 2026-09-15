import { prisma } from '@/database/prisma.js';
import { cacheDel, cacheGet, cacheSet } from '@/common/throttle.js';

/**
 * Permission resolution (architecture.md §5.1, api.md §6.1). The access token carries only
 * `pv`; the full set is loaded from Redis `perm:{userId}:{pv}` (TTL 15 min), falling back to
 * a user_roles ⋈ role_permissions ⋈ permissions query. Any role/permission change bumps
 * users.permission_version, which changes the key and makes every in-flight token resolve
 * the new set on its next request — revocation is immediate, the token stays small.
 */
const TTL = 15 * 60;

export interface ResolvedAuthority {
  roles: string[];
  permissions: Set<string>;
  permissionVersion: number;
}

export async function resolveAuthority(userId: string): Promise<ResolvedAuthority> {
  const user = await prisma().user.findUnique({ where: { id: userId }, select: { permissionVersion: true } });
  const pv = user?.permissionVersion ?? 0;
  const key = `perm:${userId}:${pv}`;
  const cached = await cacheGet(key);
  if (cached) {
    const parsed = JSON.parse(cached) as { roles: string[]; permissions: string[] };
    return { roles: parsed.roles, permissions: new Set(parsed.permissions), permissionVersion: pv };
  }
  const grants = await prisma().userRole.findMany({
    where: { userId, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { role: { select: { code: true, rolePermissions: { select: { permission: { select: { code: true } } } } } } },
  });
  const roles = grants.map((g) => g.role.code).sort();
  const permissions = new Set<string>();
  for (const g of grants) for (const rp of g.role.rolePermissions) permissions.add(rp.permission.code);
  await cacheSet(key, JSON.stringify({ roles, permissions: [...permissions] }), TTL);
  return { roles, permissions, permissionVersion: pv };
}

/** Called by anything that changes a user's roles or a role's permissions. */
export async function bumpPermissionVersion(userId: string): Promise<number> {
  const u = await prisma().user.update({ where: { id: userId }, data: { permissionVersion: { increment: 1 } }, select: { permissionVersion: true } });
  await cacheDel(`perm:${userId}:${u.permissionVersion - 1}`);
  return u.permissionVersion;
}

/** A role's permissions changed: bump every holder. */
export async function bumpPermissionVersionForRole(roleId: string): Promise<void> {
  const holders = await prisma().userRole.findMany({ where: { roleId }, select: { userId: true } });
  for (const h of holders) await bumpPermissionVersion(h.userId);
}
