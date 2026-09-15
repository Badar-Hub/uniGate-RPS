import { prisma } from '@/database/prisma.js';
import { logger } from '@/logging/logger.js';

/**
 * Housekeeping scheduled from worker.ts:
 *  - next-month partitions for the two partitioned tables (never write to the DEFAULT one)
 *  - expired idempotency keys and stale password-reset tokens
 */
export async function ensureNextMonthPartitions(): Promise<void> {
  for (const parent of ['audit_logs', 'vehicle_location_points']) {
    await prisma().$executeRaw`SELECT ensure_month_partition(${parent}::regclass, (date_trunc('month', CURRENT_DATE) + interval '1 month')::date)`;
    await prisma().$executeRaw`SELECT ensure_month_partition(${parent}::regclass, (date_trunc('month', CURRENT_DATE) + interval '2 month')::date)`;
  }
  logger().info('partition maintenance: next two months ensured');
}

export async function purgeExpired(): Promise<void> {
  const now = new Date();
  const [keys, resets] = await Promise.all([
    prisma().idempotencyKey.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma().passwordResetToken.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } },
    }),
  ]);
  logger().info({ idempotencyKeys: keys.count, resetTokens: resets.count }, 'purged expired rows');
}
