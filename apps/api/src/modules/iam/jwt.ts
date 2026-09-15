import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { config } from '@/config/index.js';
import { UnauthorizedError } from '@/common/errors.js';

/**
 * Access-token JWTs (security.md §3.5). HS256 with a ≥32-byte secret; `alg` is PINNED at
 * verification; `iss`/`aud`/`typ` are verified, not merely present. Permission codes are
 * deliberately NOT in the token — only `roles` and `pv` (permission version).
 */
export const JWT_ISSUER = 'unigate-api';
export const JWT_AUDIENCE = 'unigate-clients';

export type TokenType = 'access' | 'impersonation';

export interface AccessClaims {
  sub: string;
  sid: string;
  roles: string[];
  pv: number;
  typ: TokenType;
  /** Impersonation only: the staff user actually acting. */
  act?: string;
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();
function secret(): Uint8Array {
  return encoder.encode(config().auth.jwtSecret);
}

export async function signAccessToken(
  claims: Pick<AccessClaims, 'sub' | 'sid' | 'roles' | 'pv'> & { typ?: TokenType; act?: string },
  opts: { ttlSeconds?: number; minIssuedAt?: number } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const ttlSeconds = opts.ttlSeconds ?? config().auth.accessTokenTtlSeconds;
  // `iat` has second granularity. A token minted in the same second as a password change must
  // still outlive the global-invalidation rule (authenticate.ts step 4), so callers pass the
  // password epoch as a floor and the token is dated at or after it (at most 1s ahead of now).
  const now = Math.max(Math.floor(Date.now() / 1000), opts.minIssuedAt ?? 0);
  const exp = now + ttlSeconds;
  const jwt = new SignJWT({ sid: claims.sid, roles: claims.roles, pv: claims.pv, typ: claims.typ ?? 'access', ...(claims.act ? { act: claims.act } : {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(exp);
  return { token: await jwt.sign(secret()), expiresAt: new Date(exp * 1000) };
}

/**
 * Verifies signature, algorithm, issuer, audience and expiry. Maps jose errors to the
 * AUTH_* codes in api.md §4.1. Never throws anything but UnauthorizedError.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims> {
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      clockTolerance: 5,
    });
    const typ = payload['typ'];
    if (typ !== 'access' && typ !== 'impersonation') {
      throw new UnauthorizedError('AUTH_TOKEN_INVALID', 'Token type is not accepted here');
    }
    if (typeof payload.sub !== 'string' || typeof payload['sid'] !== 'string' || typeof payload['pv'] !== 'number' || !Array.isArray(payload['roles'])) {
      throw new UnauthorizedError('AUTH_TOKEN_INVALID', 'Token claims are malformed');
    }
    return {
      sub: payload.sub,
      sid: payload['sid'],
      roles: (payload['roles'] as unknown[]).filter((r): r is string => typeof r === 'string'),
      pv: payload['pv'],
      typ,
      ...(typeof payload['act'] === 'string' ? { act: payload['act'] } : {}),
      iat: payload.iat ?? 0,
      exp: payload.exp ?? 0,
    };
  } catch (e) {
    if (e instanceof UnauthorizedError) throw e;
    if (e instanceof joseErrors.JWTExpired) throw new UnauthorizedError('AUTH_TOKEN_EXPIRED', 'Access token has expired');
    throw new UnauthorizedError('AUTH_TOKEN_INVALID', 'Access token is invalid');
  }
}
