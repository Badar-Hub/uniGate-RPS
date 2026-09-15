import { redis } from '@/database/redis.js';
import { config } from '@/config/index.js';
import { RateLimitError } from '@/common/errors.js';
import { logger } from '@/logging/logger.js';

/**
 * Sliding-window counters in Redis (security.md §3.3, §3.4, §11). Keys carry hashes, never
 * plaintext identifiers. If Redis is unreachable the throttle FAILS OPEN with a warning —
 * an infrastructure blip must not take login down — but the login_attempts / otp_requests
 * tables remain the durable record either way.
 */
export interface Window {
  /** Max events in the window. */
  limit: number;
  /** Window length in seconds. */
  seconds: number;
}

/** Records one hit and returns whether the window is exceeded. */
export async function hit(key: string, w: Window): Promise<{ count: number; exceeded: boolean; retryAfterSeconds: number }> {
  try {
    const r = redis(config().redisUrl);
    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;
    const k = `thr:${key}`;
    const results = await r
      .multi()
      .zremrangebyscore(k, 0, now - w.seconds * 1000)
      .zadd(k, now, member)
      .zcard(k)
      .expire(k, w.seconds)
      .exec();
    const count = Number(results?.[2]?.[1] ?? 0);
    return { count, exceeded: count > w.limit, retryAfterSeconds: w.seconds };
  } catch (err) {
    logger().warn({ err, key: key.split(':')[0] }, 'throttle unavailable — failing open');
    return { count: 0, exceeded: false, retryAfterSeconds: 0 };
  }
}

/** Reads the current count without recording a hit. */
export async function peek(key: string, w: Window): Promise<number> {
  try {
    const r = redis(config().redisUrl);
    const k = `thr:${key}`;
    await r.zremrangebyscore(k, 0, Date.now() - w.seconds * 1000);
    return await r.zcard(k);
  } catch {
    return 0;
  }
}

export async function reset(key: string): Promise<void> {
  try {
    await redis(config().redisUrl).del(`thr:${key}`);
  } catch {
    /* fail open */
  }
}

/** Enforces every window; throws RateLimitError (429 + Retry-After) on the first breach. */
export async function enforce(code: string, checks: { key: string; window: Window }[]): Promise<void> {
  for (const c of checks) {
    const r = await hit(c.key, c.window);
    if (r.exceeded) throw new RateLimitError(r.retryAfterSeconds, code, 'Too many attempts');
  }
}

/** Small generic cache helpers on the same connection. */
export async function cacheGet(key: string): Promise<string | null> {
  try {
    return await redis(config().redisUrl).get(key);
  } catch {
    return null;
  }
}
export async function cacheSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  try {
    await redis(config().redisUrl).set(key, value, 'EX', ttlSeconds);
  } catch {
    /* fail open */
  }
}
export async function cacheDel(...keys: string[]): Promise<void> {
  try {
    if (keys.length) await redis(config().redisUrl).del(...keys);
  } catch {
    /* fail open */
  }
}
