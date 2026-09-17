import { z } from 'zod';

/**
 * Environment schema — parsed ONCE at boot, before the HTTP server binds (security.md §7.2).
 *
 * A failure prints the offending key NAMES (never values) and exits non-zero. A crash-loop on
 * a misconfigured deploy is the desired behaviour; an API that silently signs tokens with
 * "changeme" is not.
 */

const PLACEHOLDER = /^(changeme|secret|password|test|example|xxx+|todo|placeholder|your[-_]|sample)/i;

const SECRET_KEYS = [
  'SMTP_PASSWORD',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY',
  'BLIND_INDEX_PEPPER',
  'OTP_PEPPER',
  'STORAGE_SECRET_KEY',
  'PAYMENT_API_KEY',
  'PAYMENT_WEBHOOK_SECRET',
  'MAPS_SERVER_KEY',
] as const;

const optionalSecret = z.string().optional();

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    APP_URL: z.string().url(),
    API_URL: z.string().url(),
    CORS_ORIGINS: z.string().min(1),
    API_DOCS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    DATABASE_URL: z.string().url(),
    TEST_DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url(),

    STORAGE_ENDPOINT: z.string().url(),
    STORAGE_REGION: z.string().default('me-south-1'),
    STORAGE_BUCKET: z.string().min(1),
    STORAGE_QUARANTINE_BUCKET: z.string().min(1),
    STORAGE_ACCESS_KEY: z.string().min(1),
    STORAGE_SECRET_KEY: z.string().min(1),
    STORAGE_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),

    JWT_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(2_592_000),
    /** base64 of 32 bytes = 44 chars */
    ENCRYPTION_KEY: z.string().min(44).refine(isBase64Of32Bytes, 'must be base64 of exactly 32 bytes'),
    ENCRYPTION_KEY_ID: z.string().min(1).max(32),
    BLIND_INDEX_PEPPER: z.string().min(32),
    OTP_PEPPER: z.string().min(32),
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).default(65536),
    ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),
    /** Global rate-limit tiers (security.md §6.8). Ceilings, not business rules — hence env, not settings. Off under test by default. */
    RATE_LIMIT_ENABLED: z.enum(['true', 'false']).optional(),
    RATE_LIMIT_GLOBAL_PER_5MIN: z.coerce.number().int().positive().default(600),
    RATE_LIMIT_ANON_PER_MIN: z.coerce.number().int().positive().default(120),
    RATE_LIMIT_READS_PER_MIN: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_WRITES_PER_MIN: z.coerce.number().int().positive().default(120),
    /** Web CSP: report-only until go-live (security.md §6.3). The API collects reports at /platform/csp-report. */
    CSP_ENFORCE: z.enum(['true', 'false']).default('false'),

    PAYMENT_PROVIDER: z.enum(['mock', 'hyperpay', 'moyasar', 'paytabs', 'checkout']),
    PAYMENT_API_KEY: optionalSecret,
    PAYMENT_WEBHOOK_SECRET: optionalSecret,
    OTP_PROVIDER: z.enum(['console', 'unifonic', 'taqnyat', 'msegat', 'twilio']),
    /** E-invoicing (ADR-007): `none` = plain invoices, clearanceStatus NOT_REQUIRED; `mock` = the development stand-in. */
    EINVOICING_PROVIDER: z.enum(['none', 'mock']).default('mock'),
    OTP_ALLOWED_COUNTRY_CODES: z.string().default('+966'),
    /** Malware scanning of uploads. `none` = uploads are accepted UNSCANNED (A-25: no scanner procured). */
    SCAN_PROVIDER: z.enum(['none', 'clamav']).default('none'),
    CLAMAV_HOST: z.string().optional(),
    CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
    MAPS_SERVER_KEY: z.string().optional(),
    NEXT_PUBLIC_MAPS_BROWSER_KEY: z.string().optional(),
    /** Notification channels (FR-NOTIFICATIONS-01). Provider CHOICE is env; behaviour is settings. 'console' variants are dev-only. */
    EMAIL_PROVIDER: z.enum(['console', 'mailhog', 'smtp', 'ses']).default('mailhog'),
    EMAIL_FROM: z.string().default('UniGate <no-reply@unigate.local>'),
    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: optionalSecret,
    SMTP_SECURE: z.enum(['true', 'false']).default('false'),
    /** Transactional SMS (OQ-10 / B-9) — the adapter lands with procurement; 'console' prints. */
    SMS_PROVIDER: z.enum(['console', 'unifonic', 'taqnyat', 'msegat', 'twilio']).default('console'),
    /** Mobile push — 'none' skips the channel (device tokens are still stored); 'expo' relays through the Expo Push Service (ADR-011); 'fcm' is reserved for a direct FCM adapter. */
    PUSH_PROVIDER: z.enum(['none', 'expo', 'fcm']).default('none'),
    /** EAS access token presented to the Expo Push Service — optional, but without it anyone holding a device token can push to it. */
    EXPO_PUSH_ACCESS_TOKEN: optionalSecret,
    /** Custom URL scheme of the mobile app; `scheme://…` payment return URLs are allow-listed alongside APP_URL (mobile-app.md). */
    MOBILE_DEEP_LINK_SCHEME: z.string().regex(/^[a-z][a-z0-9+.-]*$/, 'must be a URL scheme').default('unigate'),

    SEED_ADMIN_EMAIL: z.string().email().optional(),
    SEED_ADMIN_PASSWORD: z.string().min(12).optional(),
  })
  .superRefine((e, ctx) => {
    for (const k of SECRET_KEYS) {
      const v = e[k];
      if (v && PLACEHOLDER.test(v)) {
        ctx.addIssue({ code: 'custom', path: [k], message: `${k} looks like a placeholder` });
      }
    }
    if (e.JWT_SECRET === e.JWT_REFRESH_SECRET) {
      ctx.addIssue({ code: 'custom', path: ['JWT_REFRESH_SECRET'], message: 'must differ from JWT_SECRET' });
    }
    if (e.BLIND_INDEX_PEPPER === e.OTP_PEPPER) {
      ctx.addIssue({ code: 'custom', path: ['OTP_PEPPER'], message: 'must differ from BLIND_INDEX_PEPPER' });
    }
    if (e.CORS_ORIGINS.includes('*')) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'wildcard CORS with credentials is forbidden' });
    }

    if (e.NODE_ENV === 'production' || e.NODE_ENV === 'staging') {
      if (e.PAYMENT_PROVIDER === 'mock' && e.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_PROVIDER'], message: 'mock gateway is forbidden in production' });
      }
      if (e.EINVOICING_PROVIDER === 'mock' && e.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: ['EINVOICING_PROVIDER'], message: 'mock e-invoicing provider is forbidden in production' });
      }
      if (e.OTP_PROVIDER === 'console' && e.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: ['OTP_PROVIDER'], message: 'console OTP provider is forbidden in production' });
      }
      if (e.SMS_PROVIDER === 'console' && e.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console SMS provider is forbidden in production' });
      }
      if ((e.EMAIL_PROVIDER === 'console' || e.EMAIL_PROVIDER === 'mailhog') && e.NODE_ENV === 'production') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'console/mailhog email providers are forbidden in production' });
      }
      if (!e.APP_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must be https outside development' });
      }
      if (!e.API_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['API_URL'], message: 'must be https outside development' });
      }
      if (e.SCAN_PROVIDER === 'clamav' && !e.CLAMAV_HOST) {
        ctx.addIssue({ code: 'custom', path: ['CLAMAV_HOST'], message: 'CLAMAV_HOST is required when SCAN_PROVIDER=clamav' });
      }
      if (e.NODE_ENV === 'production' && e.PAYMENT_PROVIDER !== 'mock' && !e.PAYMENT_WEBHOOK_SECRET) {
        ctx.addIssue({ code: 'custom', path: ['PAYMENT_WEBHOOK_SECRET'], message: 'required in production' });
      }
      if (e.NODE_ENV === 'production' && e.API_DOCS_ENABLED) {
        ctx.addIssue({ code: 'custom', path: ['API_DOCS_ENABLED'], message: 'API docs are disabled in production' });
      }
      if (e.NODE_ENV === 'production' && (e.SEED_ADMIN_EMAIL || e.SEED_ADMIN_PASSWORD)) {
        ctx.addIssue({ code: 'custom', path: ['SEED_ADMIN_EMAIL'], message: 'seed admin credentials must not be set in production' });
      }
      if (process.env['NODE_TLS_REJECT_UNAUTHORIZED'] === '0') {
        ctx.addIssue({ code: 'custom', path: ['NODE_TLS_REJECT_UNAUTHORIZED'], message: 'TLS verification cannot be disabled' });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

function isBase64Of32Bytes(v: string): boolean {
  try {
    return Buffer.from(v, 'base64').length === 32;
  } catch {
    return false;
  }
}

export class EnvValidationError extends Error {
  constructor(public readonly keys: readonly string[]) {
    super(`Environment validation failed for: ${keys.join(', ')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses `source` (default `process.env`). Throws EnvValidationError listing key NAMES only.
 * Callers at the process entrypoint print the message and `process.exit(1)`.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((i) => i.path.join('.') || '(root)'))];
    throw new EnvValidationError(keys);
  }
  return result.data;
}

/** Every key the schema knows about — CI asserts each appears in .env.example. */
export const ENV_KEYS = Object.keys(envSchema._def.schema.shape) as readonly string[];
