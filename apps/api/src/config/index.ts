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
  crypto: {
    encryptionKey: Buffer;
    encryptionKeyId: string;
    blindIndexPepper: string;
    otpPepper: string;
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
    otp: Env['OTP_PROVIDER'];
    scan: Env['SCAN_PROVIDER'];
    clamav: { host: string | null; port: number };
    otpAllowedCountryCodes: readonly string[];
    email: Env['EMAIL_PROVIDER'];
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
    crypto: {
      encryptionKey: Buffer.from(env.ENCRYPTION_KEY, 'base64'),
      encryptionKeyId: env.ENCRYPTION_KEY_ID,
      blindIndexPepper: env.BLIND_INDEX_PEPPER,
      otpPepper: env.OTP_PEPPER,
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
      otp: env.OTP_PROVIDER,
      scan: env.SCAN_PROVIDER,
      clamav: { host: env.CLAMAV_HOST ?? null, port: env.CLAMAV_PORT },
      otpAllowedCountryCodes: env.OTP_ALLOWED_COUNTRY_CODES.split(',').map((s) => s.trim()),
      email: env.EMAIL_PROVIDER,
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
