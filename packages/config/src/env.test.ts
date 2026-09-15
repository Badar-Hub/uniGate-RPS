import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.js';

const b64key = Buffer.alloc(32, 7).toString('base64');
const valid: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:3000',
  API_URL: 'http://localhost:4000',
  CORS_ORIGINS: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  STORAGE_ENDPOINT: 'http://localhost:9000',
  STORAGE_BUCKET: 'docs',
  STORAGE_QUARANTINE_BUCKET: 'q',
  STORAGE_ACCESS_KEY: 'minio-access-key-1234',
  STORAGE_SECRET_KEY: 'k9Xv2pQm7Lw4Rt8Yb3Nz6Hc1Fd5Gj0Ka',
  JWT_SECRET: 'a3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3',
  JWT_REFRESH_SECRET: 'z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2h1g0',
  ENCRYPTION_KEY: b64key,
  ENCRYPTION_KEY_ID: 'dev-1',
  BLIND_INDEX_PEPPER: 'pepper-one-1234567890-abcdefghij-xyz',
  OTP_PEPPER: 'pepper-two-0987654321-klmnopqrst-uvw',
  PAYMENT_PROVIDER: 'mock',
  OTP_PROVIDER: 'console',
};

function names(fn: () => unknown): string[] {
  try {
    fn();
    return [];
  } catch (e) {
    if (e instanceof EnvValidationError) return [...e.keys];
    throw e;
  }
}

describe('env schema', () => {
  it('parses a valid development env', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.API_DOCS_ENABLED).toBe(false);
  });

  it('rejects placeholder-looking secrets by key name only', () => {
    expect(names(() => loadEnv({ ...valid, JWT_SECRET: 'changeme-changeme-changeme-changeme' }))).toEqual(['JWT_SECRET']);
  });

  it('rejects identical JWT secrets and identical peppers', () => {
    expect(names(() => loadEnv({ ...valid, JWT_REFRESH_SECRET: valid["JWT_SECRET"] }))).toContain('JWT_REFRESH_SECRET');
    expect(names(() => loadEnv({ ...valid, OTP_PEPPER: valid["BLIND_INDEX_PEPPER"] }))).toContain('OTP_PEPPER');
  });

  it('rejects an ENCRYPTION_KEY that is not 32 bytes', () => {
    expect(names(() => loadEnv({ ...valid, ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') + 'AAAAAAAAAAAAAAAAAAAAAAAAAAAA' }))).toContain('ENCRYPTION_KEY');
  });

  it('forbids mock providers, http origins, docs and seed credentials in production', () => {
    const prod = { ...valid, NODE_ENV: 'production', API_DOCS_ENABLED: 'true', SEED_ADMIN_EMAIL: 'a@b.co', SEED_ADMIN_PASSWORD: 'longenoughpassword' };
    const keys = names(() => loadEnv(prod));
    for (const k of ['PAYMENT_PROVIDER', 'OTP_PROVIDER', 'APP_URL', 'API_URL', 'API_DOCS_ENABLED', 'SEED_ADMIN_EMAIL']) {
      expect(keys).toContain(k);
    }
  });

  it('never includes values in the error', () => {
    const err = (() => { try { loadEnv({ ...valid, JWT_SECRET: 'changeme-changeme-changeme-changeme' }); } catch (e) { return e as Error; } return null; })();
    expect(err?.message).not.toContain('changeme');
  });
});
