import { Router, type Request, type Response } from 'express';
import type { HealthDto, ReadinessDto } from '@unigate/types';
import { ok } from '@/common/envelope.js';
import { prisma } from '@/database/prisma.js';
import { redis } from '@/database/redis.js';
import { config } from '@/config/index.js';

const startedAt = Date.now();

/**
 * GET /health — liveness only. GET /ready — dependency reachability as BOOLEANS.
 * Neither ever reports versions, hostnames, connection strings or config (security.md §7.2).
 */
export function healthRouter(): Router {
  const r = Router({ strict: true });

  r.get('/health', (_req: Request, res: Response) => {
    const dto: HealthDto = { status: 'ok', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) };
    res.status(200).json(ok(dto));
  });

  r.get('/ready', async (_req: Request, res: Response) => {
    const [database, cache] = await Promise.all([checkDatabase(), checkRedis()]);
    const dto: ReadinessDto = { ready: database && cache, checks: { database, redis: cache } };
    if (!dto.ready) res.setHeader('Retry-After', '5');
    res.status(dto.ready ? 200 : 503).json(ok(dto));
  });

  return r;
}

async function checkDatabase(): Promise<boolean> {
  try {
    await withTimeout(prisma().$queryRaw`SELECT 1`, 2000);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    const r = redis(config().redisUrl);
    if (r.status !== 'ready') await withTimeout(r.connect(), 2000).catch(() => undefined);
    const pong: string = await withTimeout(r.ping(), 2000);
    return pong === 'PONG';
  } catch {
    return false;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { reject(new Error('timeout')); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e: unknown) => { clearTimeout(t); reject(e instanceof Error ? e : new Error(String(e))); });
  });
}
