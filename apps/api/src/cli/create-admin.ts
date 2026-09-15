/**
 * First production administrator (security.md §2.4 / Phase 3 exit item).
 *
 *   ADMIN_EMAIL=ops@unigate.sa ADMIN_PASSWORD='…' pnpm --filter @unigate/api admin:create
 *
 * Runs against the DATABASE_URL of the environment it is executed in — never from seeds, so
 * production never carries a known credential. The password is read from the environment
 * only (it never appears in argv, shell history, or logs) and must satisfy the staff policy.
 */
import { config } from '@/config/index.js';
import { initLogger } from '@/logging/logger.js';
import { disconnectPrisma, prisma } from '@/database/prisma.js';
import { disconnectRedis } from '@/database/redis.js';
import { assertPasswordPolicy } from '@/modules/iam/auth.service.js';
import { createInitialAdmin } from '@/modules/iam/admin.service.js';
import { writeAudit } from '@/modules/platform/audit.service.js';

async function main(): Promise<number> {
  const cfg = config();
  initLogger({ level: 'warn', env: cfg.env, service: 'unigate-cli', version: cfg.version, pretty: cfg.isDevelopment });

  const email = process.env['ADMIN_EMAIL']?.trim();
  const password = process.env['ADMIN_PASSWORD'];
  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required (environment variables, not arguments).');
    return 2;
  }
  await assertPasswordPolicy(password, true, [email]);

  const existing = await prisma().user.count({ where: { deletedAt: null, userRoles: { some: { role: { code: 'SUPER_ADMIN' } } } } });
  if (existing > 0 && process.env['ADMIN_ALLOW_ADDITIONAL'] !== 'true') {
    console.error(`A SUPER_ADMIN already exists (${existing}). Set ADMIN_ALLOW_ADDITIONAL=true to add another.`);
    return 3;
  }

  const id = await createInitialAdmin(email, password);
  await writeAudit({ actorUserId: null, actorType: 'SYSTEM', action: 'user.created', entityType: 'user', entityId: id, severity: 'SECURITY', afterValue: { source: 'cli.create-admin', role: 'SUPER_ADMIN' } });
  console.log(`SUPER_ADMIN created: ${id} (${email}). Sign in and change the password on first use.`);
  return 0;
}

main()
  .then(async (code) => {
    await disconnectPrisma();
    await disconnectRedis();
    process.exitCode = code;
  })
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    await disconnectPrisma();
    await disconnectRedis();
    process.exitCode = 1;
  });
