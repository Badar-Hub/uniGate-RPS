import { PrismaClient } from '@prisma/client';
import { logger } from '@/logging/logger.js';

/**
 * Single Prisma client per process. Query logging is metadata-only (duration, model, action) —
 * parameters are never logged, because they can carry PII.
 */
let client: PrismaClient | null = null;

export function prisma(): PrismaClient {
  if (client) return client;
  const c = new PrismaClient({
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });
  c.$on('warn', (e: { target: string }) => { logger().warn({ target: e.target }, 'prisma warning'); });
  c.$on('error', (e: { target: string }) => { logger().error({ target: e.target }, 'prisma error'); });
  client = c;
  return c;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = null;
  }
}

/** Test seam. */
export function setPrismaForTests(c: PrismaClient): void {
  client = c;
}

/** The Prisma error codes the services map to domain errors. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: 'P2002',
  FK_VIOLATION: 'P2003',
  NOT_FOUND: 'P2025',
  /** raw: exclusion_violation — the vehicle calendar constraint (database.md §7.3) */
  EXCLUSION_VIOLATION: '23P01',
} as const;
