import type { ClientType, Prisma } from '@prisma/client';
import type { AnyScope } from '@unigate/types';
import { newId } from '@/common/ids.js';
import { cacheSet } from '@/common/throttle.js';
import { config } from '@/config/index.js';
import { prisma } from '@/database/prisma.js';

/**
 * Sessions and refresh tokens (database.md §5.2). Every function takes a scope; session rows
 * are always bound to a user id derived from the scope or an explicit, already-authenticated
 * subject, never from a client-supplied id.
 */
type Tx = Prisma.TransactionClient;

export interface NewSessionInput {
  userId: string;
  clientType: ClientType;
  deviceId: string | null;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
}

export async function createSession(_scope: AnyScope, input: NewSessionInput, tx: Tx | null = null): Promise<{ id: string; expiresAt: Date }> {
  const db = tx ?? prisma();
  const expiresAt = new Date(Date.now() + config().auth.refreshTokenTtlSeconds * 1000);
  const s = await db.session.create({
    data: { id: newId(), ...input, expiresAt },
    select: { id: true, expiresAt: true },
  });
  return s;
}

/** Sessions per user are capped (security.md §3.5); the oldest live ones are revoked on overflow. */
export async function enforceSessionCap(scope: AnyScope, userId: string, cap: number, tx: Tx | null = null): Promise<void> {
  const db = tx ?? prisma();
  const live = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true },
  });
  const overflow = live.slice(cap);
  for (const s of overflow) await revokeSession(scope, s.id, 'SESSION_CAP', db);
}

export async function issueRefreshToken(
  _scope: AnyScope,
  input: { sessionId: string; familyId: string; tokenHash: string; expiresAt: Date; replacesId?: string },
  tx: Tx | null = null,
): Promise<{ id: string }> {
  const db = tx ?? prisma();
  const row = await db.refreshToken.create({
    data: { id: newId(), sessionId: input.sessionId, familyId: input.familyId, tokenHash: input.tokenHash, expiresAt: input.expiresAt },
    select: { id: true },
  });
  if (input.replacesId) {
    await db.refreshToken.update({ where: { id: input.replacesId }, data: { usedAt: new Date(), replacedById: row.id } });
  }
  return row;
}

export async function findRefreshTokenForUpdate(_scope: AnyScope, tokenHash: string, tx: Tx) {
  // FOR UPDATE serialises concurrent refreshes of the same token (api.md §6.3).
  const rows = await tx.$queryRaw<
    { id: string; session_id: string; family_id: string; expires_at: Date; used_at: Date | null; revoked_at: Date | null }[]
  >`SELECT id, session_id, family_id, expires_at, used_at, revoked_at FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
  return rows[0] ?? null;
}

/** Revokes a session and every token in every family it holds; mirrors to Redis for the fast check. */
export async function revokeSession(_scope: AnyScope, sessionId: string, reason: string, tx: Tx | null = null): Promise<void> {
  const db = tx ?? prisma();
  const now = new Date();
  await db.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now, revokeReason: reason } });
  await db.refreshToken.updateMany({ where: { sessionId, revokedAt: null }, data: { revokedAt: now } });
  await cacheSet(`sess:revoked:${sessionId}`, '1', config().auth.accessTokenTtlSeconds + 60);
}

export async function revokeFamily(_scope: AnyScope, familyId: string, tx: Tx): Promise<void> {
  await tx.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function revokeAllSessions(scope: AnyScope, userId: string, reason: string, exceptSessionId: string | null = null): Promise<number> {
  const sessions = await prisma().session.findMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    select: { id: true },
  });
  for (const s of sessions) await revokeSession(scope, s.id, reason);
  return sessions.length;
}

export async function touchSession(_scope: AnyScope, sessionId: string, tx: Tx | null = null): Promise<void> {
  await (tx ?? prisma()).session.update({ where: { id: sessionId }, data: { lastSeenAt: new Date() } });
}

export async function listSessions(_scope: AnyScope, userId: string) {
  return prisma().session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, deviceName: true, clientType: true, ipAddress: true, createdAt: true, lastSeenAt: true },
  });
}

export async function findSessionOwned(_scope: AnyScope, userId: string, sessionId: string) {
  return prisma().session.findFirst({ where: { id: sessionId, userId, revokedAt: null }, select: { id: true } });
}
