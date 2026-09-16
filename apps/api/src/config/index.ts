import { loadEnv, EnvValidationError, type Env } from '@unigate/config';

/**
 * Typed config object, built from the validated env exactly once. Modules import `config`,
 * never `process.env`.
 */
export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  appUrl: string;
  apiUrl: string;
  corsOrigins: readonly string[];
  apiDocsEnabled: boolean;
  databaseUrl: string;
  redisUrl: string;
  auth: {
    jwtSecret: string;
    jwtRefreshSecret: string;
    accessTokenTtlSeconds: number;
    refreshTokenTtlSeconds: number;
    argon2: { memoryKib: number; timeCost: number; parallelism: number };
  };
  rateLimit: {
    enabled: boolean;
    global: { limit: number; seconds: number };
    anonymous: { limit: number; seconds: number };
    reads: { limit: number; seconds: number };
    writes: { limit: number; seconds: number };
  };
  crypto: {
    encryptionKey: Buffer;
    encryptionKeyId: string;
    blindIndexPepper: string;
    otpPepper: string;
    /** Gateway credentials — server-side only, never in a DTO or log (ADR-005). */
    paymentApiKey: string | null;
    paymentWebhookSecret: string | null;
  };
  storage: {
    endpoint: string;
    region: string;
    bucket: string;
    quarantineBucket: string;
    accessKey: string;
    secretKey: string;
    forcePathStyle: boolean;
  };
  providers: {
    payment: Env['PAYMENT_PROVIDER'];
    einvoicing: Env['EINVOICING_PROVIDER'];
    otp: Env['OTP_PROVIDER'];
    scan: Env['SCAN_PROVIDER'];
    clamav: { host: string | null; port: number };
    mapsServerKey: string | null;
    otpAllowedCountryCodes: readonly string[];
    email: Env['EMAIL_PROVIDER'];
    emailFrom: string;
    smtp: { host: string; port: number; user: string | null; password: string | null; secure: boolean };
    sms: Env['SMS_PROVIDER'];
    push: Env['PUSH_PROVIDER'];
  };
  version: string;
}

let cached: AppConfig | null = null;

export function buildConfig(env: Env): AppConfig {
  return {
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
    port: env.PORT,
    logLevel: env.LOG_LEVEL,
    appUrl: env.APP_URL,
    apiUrl: env.API_URL,
    corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    apiDocsEnabled: env.API_DOCS_ENABLED,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    auth: {
      jwtSecret: env.JWT_SECRET,
      jwtRefreshSecret: env.JWT_REFRESH_SECRET,
      accessTokenTtlSeconds: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
      argon2: { memoryKib: env.ARGON2_MEMORY_KIB, timeCost: env.ARGON2_TIME_COST, parallelism: env.ARGON2_PARALLELISM },
    },
    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED ? env.RATE_LIMIT_ENABLED === 'true' : env.NODE_ENV !== 'test',
      global: { limit: env.RATE_LIMIT_GLOBAL_PER_5MIN, seconds: 300 },
      anonymous: { limit: env.RATE_LIMIT_ANON_PER_MIN, seconds: 60 },
      reads: { limit: env.RATE_LIMIT_READS_PER_MIN, seconds: 60 },
      writes: { limit: env.RATE_LIMIT_WRITES_PER_MIN, seconds: 60 },
    },
    crypto: {
      encryptionKey: Buffer.from(env.ENCRYPTION_KEY, 'base64'),
      encryptionKeyId: env.ENCRYPTION_KEY_ID,
      blindIndexPepper: env.BLIND_INDEX_PEPPER,
      otpPepper: env.OTP_PEPPER,
      paymentApiKey: env.PAYMENT_API_KEY ?? null,
      paymentWebhookSecret: env.PAYMENT_WEBHOOK_SECRET ?? null,
    },
    storage: {
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      bucket: env.STORAGE_BUCKET,
      quarantineBucket: env.STORAGE_QUARANTINE_BUCKET,
      accessKey: env.STORAGE_ACCESS_KEY,
      secretKey: env.STORAGE_SECRET_KEY,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    },
    providers: {
      payment: env.PAYMENT_PROVIDER,
      einvoicing: env.EINVOICING_PROVIDER,
      otp: env.OTP_PROVIDER,
      scan: env.SCAN_PROVIDER,
      clamav: { host: env.CLAMAV_HOST ?? null, port: env.CLAMAV_PORT },
      mapsServerKey: env.MAPS_SERVER_KEY ?? null,
      otpAllowedCountryCodes: env.OTP_ALLOWED_COUNTRY_CODES.split(',').map((s) => s.trim()),
      email: env.EMAIL_PROVIDER,
      emailFrom: env.EMAIL_FROM,
      smtp: { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER ?? null, password: env.SMTP_PASSWORD ?? null, secure: env.SMTP_SECURE === 'true' },
      sms: env.SMS_PROVIDER,
      push: env.PUSH_PROVIDER,
    },
    version: process.env['GIT_SHA'] ?? process.env['npm_package_version'] ?? 'dev',
  };
}

/**
 * Loads and caches. On failure prints key NAMES only and exits — the process must never
 * boot degraded (security.md §7.2).
 */
export function config(): AppConfig {
  if (cached) return cached;
  try {
    cached = buildConfig(loadEnv());
    return cached;
  } catch (e) {
    if (e instanceof EnvValidationError) {
      console.error(`[config] ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

/** Test seam: inject a config without touching process.env. */
export function setConfigForTests(cfg: AppConfig): void {
  cached = cfg;
}
