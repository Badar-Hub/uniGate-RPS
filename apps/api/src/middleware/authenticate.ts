import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ActorIdentity, ActorScope, ScopeKind } from '@unigate/types';
import { ForbiddenError, UnauthorizedError } from '@/common/errors.js';
import { getRequestId, setContextUser } from '@/common/request-context.js';
import { cacheGet } from '@/common/throttle.js';
import { prisma } from '@/database/prisma.js';
import { verifyAccessToken, type AccessClaims } from '@/modules/iam/jwt.js';
import { resolveAuthority } from '@/modules/iam/permission.service.js';

/** Reads one cookie parsed by cookie-parser (absent when the middleware did not run). */
export function cookieOf(req: Request, name: string): string | undefined {
  const jar = (req as { cookies?: Record<string, string | undefined> }).cookies;
  return jar?.[name];
}

export const ACCESS_COOKIE = 'ug_at';
export const REFRESH_COOKIE = 'ug_rt';

export interface AuthenticatedRequest extends Request {
  actor: ActorIdentity;
  claims: AccessClaims;
  /** How the credential arrived — decides CSRF enforcement and token return mode. */
  credentialMode: 'bearer' | 'cookie';
}

export function isAuthenticated(req: Request): req is AuthenticatedRequest {
  return typeof (req as Partial<AuthenticatedRequest>).actor === 'object';
}

/**
 * authenticate() — api.md §6.2 / security.md §3.5.
 *  1. `Authorization: Bearer` first, then the `ug_at` cookie.
 *  2. Verify signature/alg/iss/aud/typ/exp.
 *  3. Session revoked? (Redis mirror `sess:revoked:{sid}`, then DB) → AUTH_SESSION_REVOKED.
 *  4. users.status ≠ ACTIVE → AUTH_ACCOUNT_SUSPENDED; password changed after iat → AUTH_PASSWORD_CHANGED.
 *  5. Resolve permissions for the CURRENT permission_version (not the token's pv).
 *  6. Attach `actor` and `credentialMode`; put userId/sid in the log context.
 *
 * `optional: true` lets a route serve both anonymous and signed-in callers.
 */
export function authenticate(opts: { optional?: boolean } = {}): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    run(req, opts.optional ?? false).then(() => {
      next();
    }, next);
  };
}

async function run(req: Request, optional: boolean): Promise<void> {
  const header = req.header('authorization');
  let token: string | null = null;
  let mode: 'bearer' | 'cookie' = 'bearer';
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7).trim();
  } else {
    const c = cookieOf(req, ACCESS_COOKIE);
    if (c) {
      token = c;
      mode = 'cookie';
    }
  }
  if (!token) {
    if (optional) return;
    throw new UnauthorizedError('AUTH_TOKEN_MISSING', 'Authentication required');
  }

  const claims = await verifyAccessToken(token);

  if ((await cacheGet(`sess:revoked:${claims.sid}`)) !== null) {
    throw new UnauthorizedError('AUTH_SESSION_REVOKED', 'Session has been revoked');
  }

  const [user, session] = await Promise.all([
    prisma().user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true, status: true, passwordChangedAt: true, preferredLocale: true, deletedAt: true,
        customerProfile: { select: { id: true } },
        ownerProfile: { select: { id: true } },
        driverProfile: { select: { id: true } },
        spoProfile: { select: { id: true } },
      },
    }),
    prisma().session.findUnique({ where: { id: claims.sid }, select: { id: true, revokedAt: true, expiresAt: true, clientType: true } }),
  ]);

  if (!user || user.deletedAt) throw new UnauthorizedError('AUTH_TOKEN_INVALID', 'Account not found');
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new UnauthorizedError('AUTH_SESSION_REVOKED', 'Session has been revoked');
  }
  if (user.status === 'SUSPENDED' || user.status === 'DEACTIVATED') {
    throw new ForbiddenError('AUTH_ACCOUNT_SUSPENDED', 'Account is suspended');
  }
  if (user.passwordChangedAt && Math.floor(user.passwordChangedAt.getTime() / 1000) > claims.iat) {
    throw new UnauthorizedError('AUTH_PASSWORD_CHANGED', 'Password was changed; please sign in again');
  }
  // Web sessions must present cookies, mobile sessions bearer tokens (api.md §6.2 mode binding).
  const expectedMode = session.clientType === 'WEB' ? 'cookie' : 'bearer';
  if (mode !== expectedMode) throw new UnauthorizedError('AUTH_TOKEN_INVALID', 'Credential transport does not match the session');

  const authority = await resolveAuthority(user.id);

  const actor: ActorIdentity = {
    userId: user.id,
    sessionId: session.id,
    roles: authority.roles,
    permissions: authority.permissions,
    customerProfileId: user.customerProfile?.id ?? null,
    ownerProfileId: user.ownerProfile?.id ?? null,
    driverProfileId: user.driverProfile?.id ?? null,
    spoProfileId: user.spoProfile?.id ?? null,
    locale: user.preferredLocale === 'en' ? 'en' : 'ar',
  };
  const r = req as AuthenticatedRequest;
  r.actor = actor;
  r.claims = claims;
  r.credentialMode = mode;
  setContextUser(user.id, session.id);
}

/**
 * Layer 1 — permission (api.md §6.5). Asks only "may this actor do this kind of thing?".
 * Failure is 403 PERM_DENIED. Scope (which rows) is the repository's job.
 */
export function requirePermission(...codes: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!isAuthenticated(req)) {
      next(new UnauthorizedError('AUTH_TOKEN_MISSING', 'Authentication required'));
      return;
    }
    const missing = codes.filter((c) => !req.actor.permissions.has(c));
    if (missing.length) {
      next(new ForbiddenError('PERM_DENIED', 'Permission denied', { required: codes }));
      return;
    }
    next();
  };
}

/**
 * Builds the ActorScope for a repository call. `GLOBAL` when the actor holds the `*_any`
 * (or otherwise administrative) code named by the route; otherwise the actor's own records.
 */
export function scopeFor(req: Request, globalPermission?: string, fallback: Exclude<ScopeKind, 'GLOBAL'> = 'OWN'): ActorScope {
  if (!isAuthenticated(req)) throw new UnauthorizedError('AUTH_TOKEN_MISSING', 'Authentication required');
  const kind: ScopeKind = globalPermission && req.actor.permissions.has(globalPermission) ? 'GLOBAL' : fallback;
  return { kind, actor: req.actor, requestId: getRequestId() };
}

export function selfScope(req: Request): ActorScope {
  return scopeFor(req, undefined, 'SELF');
}
