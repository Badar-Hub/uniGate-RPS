import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from '@/config/index.js';
import { sha256Hex } from '@/common/crypto.js';
import { RateLimitError } from '@/common/errors.js';
import { hit, type Window } from '@/common/throttle.js';
import { isAuthenticated } from './authenticate.js';

/**
 * Global rate-limiting tiers (security.md §6.8). Redis sliding windows keyed by the most specific
 * identity available — user after authentication, IP before it — with `RateLimit-*` headers on
 * every counted response and `Retry-After` + `RATE_LIMITED` (429) on rejection. Keys carry hashes
 * only. The per-feature throttles (login, OTP, tracking ping, bids, uploads, exports) sit on top
 * of these; this file is the blunt ceiling underneath them.
 *
 *   ipTier()    — mounted before the routers: `global` (every request from an IP) and `anonymous`
 *                 (requests that carry no credential at all — a caller cannot escape the user tier
 *                 by dropping their token, because the IP tiers still count them).
 *   userTier()  — invoked by authenticate() once the actor is known: reads / writes per user.
 *   routeTier() — per-route ceilings for expensive or abusable operations, keyed by user.
 *
 * Disabled when `rateLimit.enabled` is false (the default under NODE_ENV=test, where the flow
 * tests fire hundreds of requests per user in seconds); rate-limit.flow enables it explicitly.
 */

function clientIpHash(req: Request): string {
  return sha256Hex(req.ip ?? req.socket.remoteAddress ?? 'noip').slice(0, 32);
}

function hasCredential(req: Request): boolean {
  if (req.header('authorization')) return true;
  const cookie = req.header('cookie') ?? '';
  return cookie.includes('ug_at=');
}

function isWrite(req: Request): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
}

function setHeaders(res: Response, w: Window, count: number): void {
  res.setHeader('RateLimit-Limit', String(w.limit));
  res.setHeader('RateLimit-Remaining', String(Math.max(0, w.limit - count)));
}

async function count(res: Response, policy: string, key: string, w: Window): Promise<void> {
  const r = await hit(key, w);
  setHeaders(res, w, r.count);
  if (r.exceeded) throw new RateLimitError(r.retryAfterSeconds, 'RATE_LIMITED', `Rate limit exceeded for policy ${policy}`);
}

/** Paths that must never be throttled: probes and the docs page (dev only). */
const EXEMPT = new Set(['/api/v1/health', '/api/v1/ready']);

/** Mount-independent path (`req.path` is relative to the router the middleware sits in). */
function fullPath(req: Request): string {
  return `${req.baseUrl}${req.path}`;
}

export function ipTier(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const rl = config().rateLimit;
    if (!rl.enabled || EXEMPT.has(fullPath(req))) {
      next();
      return;
    }
    const ip = clientIpHash(req);
    (async () => {
      await count(res, 'global', `rl:ip:${ip}`, rl.global);
      if (!hasCredential(req)) await count(res, 'anonymous', `rl:anon:${ip}`, rl.anonymous);
    })().then(() => {
      next();
    }, next);
  };
}

/** Called by authenticate() after the actor is attached. */
export async function userTier(req: Request, res: Response): Promise<void> {
  const rl = config().rateLimit;
  if (!rl.enabled || !isAuthenticated(req)) return;
  const w = isWrite(req) ? rl.writes : rl.reads;
  await count(res, isWrite(req) ? 'writes' : 'reads', `rl:user:${req.actor.userId}:${isWrite(req) ? 'w' : 'r'}`, w);
}

/**
 * Per-route ceiling keyed by the authenticated user (falls back to the IP for public routes).
 * `policy` names the tier in the 429 message and the Redis key; `window` is the ceiling.
 */
export function routeTier(policy: string, window: Window): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const rl = config().rateLimit;
    if (!rl.enabled) {
      next();
      return;
    }
    const id = isAuthenticated(req) ? `u:${req.actor.userId}` : `ip:${clientIpHash(req)}`;
    count(res, policy, `rl:route:${policy}:${id}`, window).then(() => {
      next();
    }, next);
  };
}

/** Provider-keyed ceiling for webhook ingest (security.md §6.8: 1,000 / min per provider). */
export function providerTier(policy: string, window: Window): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const rl = config().rateLimit;
    if (!rl.enabled) {
      next();
      return;
    }
    const provider = ((req.params as Record<string, string | undefined>)['provider'] ?? 'unknown').slice(0, 32);
    count(res, policy, `rl:provider:${policy}:${provider}`, window).then(() => {
      next();
    }, next);
  };
}
