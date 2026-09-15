/**
 * The single shared redaction function (security.md §8.2).
 *
 * Used by the logger, the audit writer, the payment repository's *_payload_redacted columns
 * and the notification renderer — exactly one list to maintain. Allow-list first: callers
 * that log known shapes emit only declared keys; this deny-list is the backstop for
 * ad-hoc objects.
 *
 * Matching is case-insensitive on the leaf key, plus pattern rules for `*_encrypted`,
 * `*_blind_index` and their camelCase forms — so a NEWLY ADDED encrypted column is caught
 * without a list change (asserted by a unit test).
 */

const BANNED_KEYS = new Set(
  [
    // passwords
    'password', 'currentPassword', 'newPassword', 'passwordConfirmation', 'passwordHash', 'password_hash',
    // tokens & sessions
    'token', 'accessToken', 'refreshToken', 'refresh_token', 'tokenHash', 'token_hash', 'authorization',
    'cookie', 'set-cookie', 'x-step-up-token', 'x-csrf-token', 'stepUpToken', 'csrfToken', 'resetToken',
    // otp
    'otp', 'otpCode', 'code', 'codeHash', 'code_hash',
    // regulated identifiers
    'nationalId', 'national_id', 'iqama', 'iqamaNumber', 'licenseNumber', 'license_number', 'iban',
    'simNumber', 'sim_number', 'dateOfBirth', 'date_of_birth',
    // payment
    'pan', 'cardNumber', 'cvv', 'cvc', 'cardSecurityCode', 'expiryMonth', 'expiryYear',
    'providerToken', 'provider_token', 'paymentApiKey',
    // secrets
    'secret', 'apiKey', 'api_key', 'privateKey', 'webhookSecret', 'signature', 'x-signature',
    'encryptionKey', 'pepper', 'databaseUrl', 'database_url', 'redisUrl', 'redis_url',
    'storageSecretKey', 'storage_secret_key',
    // files — signed URLs are bearer credentials
    'signedUrl', 'presignedUrl', 'downloadUrl',
  ].map((k) => k.toLowerCase()),
);

const BANNED_KEY_PATTERNS: readonly RegExp[] = [
  /_encrypted$/i,
  /encrypted$/i,
  /_blind_index$/i,
  /blindindex$/i,
  /secret/i,
  /password/i,
  /_pepper$/i,
];

/** Location fields are not banned but are coarsened to ~1 km outside debug (handled by the logger). */
export const LOCATION_KEYS = new Set(['latitude', 'longitude', 'lat', 'lng', 'coordinates']);

export const REDACTED = '[REDACTED]';

export function isBannedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (BANNED_KEYS.has(lower)) return true;
  return BANNED_KEY_PATTERNS.some((p) => p.test(key));
}

const MAX_DEPTH = 12;

/**
 * Returns a deep copy with banned keys replaced by `[REDACTED]`. Never mutates the input.
 * Cycles and excessive depth are cut off rather than thrown on — the logger must never crash
 * the request it is logging.
 */
export function redact<T>(value: T): T {
  return redactInner(value, 0, new WeakSet()) as T;
}

function redactInner(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return '[MaxDepth]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`;
  if (Array.isArray(value)) return value.map((v) => redactInner(v, depth + 1, seen));
  if (value instanceof Map || value instanceof Set) return `[${value.constructor.name} size=${value.size}]`;
  if (value instanceof Error) {
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(value)) extra[k] = (value as unknown as Record<string, unknown>)[k];
    return { name: value.name, message: value.message, stack: value.stack, ...(redactInner(extra, depth + 1, seen) as object) };
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isBannedKey(k) ? REDACTED : redactInner(v, depth + 1, seen);
  }
  return out;
}

/** Masks a phone for logs: `+966 5•• ••• •12`. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 6) return '•••';
  return `${phone.slice(0, 5)}•• ••• •${digits.slice(-2)}`;
}

/** Masks an email for logs: `b•••@example.com`. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '•••';
  return `${email[0]}•••${email.slice(at)}`;
}

/** pino `redact.paths` derived from the same list, so the logger's backstop cannot drift. */
export function pinoRedactPaths(): string[] {
  const keys = [...BANNED_KEYS];
  const paths: string[] = [];
  for (const k of keys) {
    // pino paths: top-level, one level under common containers, and wildcard leaf.
    paths.push(k, `*.${k}`, `req.headers.${k}`, `req.body.${k}`, `res.headers.${k}`, `err.${k}`, `*.*.${k}`);
  }
  return paths;
}
