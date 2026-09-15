import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { HEADER_IDEMPOTENCY_KEY } from '@unigate/types';
import { BadRequestError, ConflictError } from '@/common/errors.js';
import { sha256Hex } from '@/common/crypto.js';
import { prisma } from '@/database/prisma.js';
import { isAuthenticated } from '@/middleware/authenticate.js';
import { logger } from '@/logging/logger.js';

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const TTL_HOURS = 24;

/**
 * Idempotency (api.md §7). `INSERT … ON CONFLICT DO NOTHING` is the concurrency control:
 * exactly one caller owns a key; a concurrent duplicate sees IN_PROGRESS and is told to wait.
 * Completed responses — including 4xx business failures — replay byte-identical with
 * `Idempotency-Replayed: true` and `meta.idempotentReplay = true`. 5xx rows are deleted so a
 * retry genuinely retries.
 */
export function idempotent(opts: { required: boolean } = { required: true }): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.header(HEADER_IDEMPOTENCY_KEY);
    if (!key) {
      if (opts.required) {
        next(
          new BadRequestError(
            'IDEMPOTENCY_KEY_REQUIRED',
            `${HEADER_IDEMPOTENCY_KEY} header is required on this endpoint`,
          ),
        );
        return;
      }
      next();
      return;
    }
    if (!KEY_PATTERN.test(key)) {
      next(
        new BadRequestError(
          'IDEMPOTENCY_KEY_INVALID',
          'Idempotency-Key must be 16–128 characters of [A-Za-z0-9_-]',
        ),
      );
      return;
    }
    handle(req, res, next, key).catch(next);
  };
}

async function handle(req: Request, res: Response, next: NextFunction, key: string): Promise<void> {
  const userId = isAuthenticated(req) ? req.actor.userId : null;
  const endpoint = `${req.method} ${req.baseUrl}${routePath(req)}`;
  const requestHash = sha256Hex(
    `${req.method}\n${req.originalUrl.split('?')[0] ?? ''}\n${canonicalJson(req.body)}`,
  );
  // Keys are scoped to the user (api.md §7.2) — two users may coincidentally use the same string.
  const scopedKey = `${userId ?? 'anon'}:${key}`;
  const expiresAt = new Date(Date.now() + TTL_HOURS * 3_600_000);

  const inserted = await prisma().$executeRaw`
    INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, status, created_at, expires_at)
    VALUES (${scopedKey}, ${userId}::uuid, ${endpoint}, ${requestHash}, 'IN_PROGRESS', now(), ${expiresAt})
    ON CONFLICT (key) DO NOTHING`;

  if (inserted === 0) {
    const existing = await prisma().idempotencyKey.findUnique({ where: { key: scopedKey } });
    if (existing?.endpoint !== endpoint || existing.requestHash !== requestHash) {
      throw new ConflictError(
        'IDEMPOTENCY_KEY_REUSED',
        `Idempotency-Key ${key} was first used with a different request`,
        {
          key,
          originalEndpoint: existing?.endpoint,
          originalRequestedAt: existing?.createdAt.toISOString(),
        },
      );
    }
    if (existing.status === 'IN_PROGRESS') {
      res.setHeader('Retry-After', '2');
      throw new ConflictError(
        'IDEMPOTENCY_REQUEST_IN_PROGRESS',
        'A request with this Idempotency-Key is still being processed',
      );
    }
    const body = existing.responseBody as Record<string, unknown> | null;
    res.setHeader('Idempotency-Replayed', 'true');
    const replayed =
      body && typeof body === 'object'
        ? { ...body, meta: { ...((body['meta'] as object | undefined) ?? {}), idempotentReplay: true } }
        : body;
    res.status(existing.responseStatus ?? 200).json(replayed);
    return;
  }

  // We own the key. Capture the response and persist it once the handler finishes.
  const originalJson = res.json.bind(res);
  res.json = ((payload: unknown) => {
    const status = res.statusCode;
    const persist =
      status >= 500
        ? prisma().idempotencyKey.delete({ where: { key: scopedKey } })
        : prisma().idempotencyKey.update({
            where: { key: scopedKey },
            data: {
              status: 'COMPLETED',
              responseStatus: status,
              responseBody: payload as Prisma.InputJsonValue,
            },
          });
    persist.catch((err: unknown) => {
      logger().error({ err }, 'failed to persist idempotent response');
    });
    return originalJson(payload);
  }) as Response['json'];
  next();
}

function routePath(req: Request): string {
  const route = (req as { route?: { path?: unknown } }).route;
  return typeof route?.path === 'string' ? route.path : req.path;
}

/** Keys sorted recursively, no whitespace — so key order never makes identical bodies differ. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, val]) => [k, sortKeys(val)]),
    );
  }
  return v;
}
