/**
 * Shared harness for database-backed tests. Boots the real Express app against
 * TEST_DATABASE_URL with the seed applied once, captures OTP codes from a test provider, and
 * offers login helpers per role. Redis is the real one from .env (throttle keys are cleared
 * between files).
 */
import '@/config/dotenv.js'; // root .env -> process.env (dev only; CI supplies the environment)
import { execSync } from 'node:child_process';
import path from 'node:path';
import request, { type Test } from 'supertest';
import type { Express } from 'express';
import type { OtpChannel, OtpPurpose } from '@unigate/types';
import { loadEnv } from '@unigate/config';
import { buildConfig, setConfigForTests } from '@/config/index.js';
import { initLogger } from '@/logging/logger.js';
import { setOtpProviderForTests, type OtpProvider } from '@/integrations/otp/otp.provider.js';
import { prisma, disconnectPrisma } from '@/database/prisma.js';
import { redis, disconnectRedis } from '@/database/redis.js';
import { closeQueues } from '@/jobs/queues.js';

export const TEST_DB = process.env['TEST_DATABASE_URL'] ?? '';
if (TEST_DB && TEST_DB === process.env['DATABASE_URL']) throw new Error('TEST_DATABASE_URL must not equal DATABASE_URL');
const apiRoot = path.resolve(import.meta.dirname, '../..');

/** Captures every OTP so tests can read it; never sends anything. */
export class CapturingOtpProvider implements OtpProvider {
  readonly code = 'test';
  readonly sent: { channel: OtpChannel; destination: string; code: string; purpose: OtpPurpose }[] = [];
  async send(input: { channel: OtpChannel; destination: string; code: string; purpose: OtpPurpose }): Promise<void> {
    this.sent.push(input);
    await Promise.resolve();
  }
  last(purpose: OtpPurpose, destination?: string): string {
    const hit = [...this.sent].reverse().find((s) => s.purpose === purpose && (!destination || s.destination === destination));
    if (!hit) throw new Error(`no OTP captured for ${purpose}`);
    return hit.code;
  }
}

export interface Harness {
  app: Express;
  otp: CapturingOtpProvider;
  adminEmail: string;
  adminPassword: string;
}

export async function bootHarness(opts: { resetDb?: boolean } = {}): Promise<Harness> {
  if (!TEST_DB) throw new Error('TEST_DATABASE_URL is required');
  // PrismaClient reads DATABASE_URL from process.env, not from the typed config — point it at
  // the test database BEFORE the lazy client is created, or the app under test hits dev data.
  process.env['DATABASE_URL'] = TEST_DB;
  process.env['NODE_ENV'] = 'test';
  const env = loadEnv({ ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DB, API_DOCS_ENABLED: 'false', OTP_PROVIDER: 'console' });
  setConfigForTests(buildConfig(env));
  initLogger({ level: 'error', env: 'test', service: 'unigate-api-test', version: 'test', pretty: false });

  if (opts.resetDb ?? true) {
    execSync('pnpm exec prisma migrate reset --force --skip-seed --skip-generate', { cwd: apiRoot, env: { ...process.env, DATABASE_URL: TEST_DB }, stdio: 'pipe' });
    execSync('pnpm exec tsx prisma/seed/index.ts', {
      cwd: apiRoot,
      env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DB, SEED_ADMIN_EMAIL: 'admin@test.local', SEED_ADMIN_PASSWORD: 'test-admin-password-1' },
      stdio: 'pipe',
    });
  }
  const otp = new CapturingOtpProvider();
  setOtpProviderForTests(otp);
  await clearThrottles();
  const { createApp } = await import('@/app.js');
  const { config } = await import('@/config/index.js');
  return { app: createApp(config()), otp, adminEmail: 'admin@test.local', adminPassword: 'test-admin-password-1' };
}

export async function clearThrottles(): Promise<void> {
  const r = redis(loadEnv({ ...process.env, NODE_ENV: 'test', DATABASE_URL: TEST_DB }).REDIS_URL);
  if (r.status !== 'ready') await r.connect().catch(() => undefined);
  const keys = await r.keys('thr:*');
  const perms = await r.keys('perm:*');
  const sess = await r.keys('sess:*');
  const step = await r.keys('stepup:*');
  const all = [...keys, ...perms, ...sess, ...step];
  if (all.length) await r.del(...all);
}

export async function teardownHarness(): Promise<void> {
  setOtpProviderForTests(null);
  await closeQueues();
  await disconnectPrisma();
  await disconnectRedis();
}

/** Bearer login (mobile mode) — returns tokens in the body. */
export async function loginBearer(app: Express, identifier: string, password: string): Promise<{ accessToken: string; refreshToken: string; userId: string }> {
  const res = await request(app).post('/api/v1/auth/login').send({ identifier, password, clientType: 'IOS', deviceId: 'test-device-0001' });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { accessToken: res.body.data.tokens.accessToken, refreshToken: res.body.data.tokens.refreshToken, userId: res.body.data.userId };
}

export function bearer(t: Test, token: string): Test {
  return t.set('Authorization', `Bearer ${token}`);
}

/** Creates an ACTIVE user with the given roles directly (bypassing OTP) for matrix tests. */
export async function createUserWithRoles(email: string, password: string, roleCodes: string[], profile: 'CUSTOMER' | 'OWNER' | 'DRIVER' | 'NONE' = 'NONE'): Promise<string> {
  const { hashPassword } = await import('@/common/crypto.js');
  const { v7 } = await import('uuid');
  const db = prisma();
  const roles = await db.role.findMany({ where: { code: { in: roleCodes } }, select: { id: true } });
  const id = v7();
  await db.user.create({
    data: {
      id, email, phoneE164: `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, phoneVerifiedAt: new Date(), emailVerifiedAt: new Date(),
      passwordHash: await hashPassword(password), passwordChangedAt: new Date(Date.now() - 5000), fullNameEn: email, status: 'ACTIVE', preferredLocale: 'en',
      userRoles: { create: roles.map((r) => ({ roleId: r.id })) },
      ...(profile === 'CUSTOMER' ? { customerProfile: { create: { id: v7(), customerType: 'INDIVIDUAL' } } } : {}),
      ...(profile === 'OWNER' ? { ownerProfile: { create: { id: v7(), ownerType: 'COMPANY', onboardingStatus: 'APPROVED' } } } : {}),
      ...(profile === 'DRIVER' ? { driverProfile: { create: { id: v7(), idType: 'NATIONAL_ID', approvalStatus: 'APPROVED' } } } : {}),
    },
  });
  return id;
}
