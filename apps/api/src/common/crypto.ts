import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { config } from '@/config/index.js';

/**
 * Cryptographic primitives (security.md §3.1, §3.4, §5.4). One module, so every caller uses
 * the same algorithms, the same peppers and the same constant-time comparison.
 */

// ── passwords: Argon2id ──────────────────────────────────────────────────────

function argonOptions() {
  const { memoryKib, timeCost, parallelism } = config().auth.argon2;
  return { type: argon2.argon2id, memoryCost: memoryKib, timeCost, parallelism, hashLength: 32 } as const;
}

/** NFKC-normalised before hashing so Arabic/Unicode passphrases compare consistently. */
export function normalisePassword(raw: string): string {
  return raw.normalize('NFKC');
}

export async function hashPassword(raw: string): Promise<string> {
  return argon2.hash(normalisePassword(raw), argonOptions());
}

/**
 * Verifies and reports whether the stored hash's parameters are below the current
 * configuration, so the caller can transparently re-hash on a successful login.
 */
export async function verifyPassword(hash: string, raw: string): Promise<{ ok: boolean; needsRehash: boolean }> {
  const ok = await argon2.verify(hash, normalisePassword(raw));
  return { ok, needsRehash: ok && argon2.needsRehash(hash, argonOptions()) };
}

/**
 * A fixed, valid Argon2id hash verified when the user does not exist, so timing does not
 * separate "unknown identifier" from "wrong password" (security.md T-11). Computed once at
 * first use with the live parameters.
 */
let dummyHash: string | null = null;
export async function dummyVerify(raw: string): Promise<void> {
  dummyHash ??= await argon2.hash('unigate-dummy-password-for-timing', argonOptions());
  await argon2.verify(dummyHash, normalisePassword(raw)).catch(() => false);
}

// ── HMAC & hashes ────────────────────────────────────────────────────────────

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** OTP codes: HMAC-SHA256(code, OTP_PEPPER) — never the code itself. */
export function hashOtp(code: string): string {
  return createHmac('sha256', config().crypto.otpPepper).update(code).digest('hex');
}

/** Blind index for exact-match lookup of encrypted PII without decrypting it. */
export function blindIndex(value: string): string {
  return createHmac('sha256', config().crypto.blindIndexPepper).update(normaliseIdentifier(value)).digest('hex');
}

/** Identifier hashes for throttle keys and login_attempts — Redis never holds plaintext. */
export function identifierHash(value: string): string {
  return sha256Hex(normaliseIdentifier(value));
}

export function normaliseIdentifier(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

/** Constant-time equality on hex digests. */
export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ab.length !== bb.length || ab.length === 0) return false;
  return timingSafeEqual(ab, bb);
}

// ── random ───────────────────────────────────────────────────────────────────

/** 256-bit opaque token, base64url (refresh tokens, reset tokens). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Numeric OTP of `length` digits from the CSPRNG — Math.random() is banned by lint. */
export function randomOtp(length: number): string {
  const max = 10 ** length;
  return randomInt(0, max).toString().padStart(length, '0');
}

// ── PII encryption: AES-256-GCM ──────────────────────────────────────────────

/**
 * Ciphertext format: `v1:<keyId>:<iv b64>:<tag b64>:<data b64>`. The key id is embedded so
 * rotation and cross-environment detection work (security.md §7.1 "Separation").
 */
export function encryptPii(plaintext: string): string {
  const { encryptionKey, encryptionKeyId } = config().crypto;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${encryptionKeyId}:${iv.toString('base64')}:${tag.toString('base64')}:${data.toString('base64')}`;
}

export function decryptPii(ciphertext: string): string {
  const [version, keyId, ivB64, tagB64, dataB64] = ciphertext.split(':');
  if (version !== 'v1' || !keyId || !ivB64 || !tagB64 || !dataB64) throw new Error('Unrecognised ciphertext format');
  const { encryptionKey, encryptionKeyId } = config().crypto;
  if (keyId !== encryptionKeyId) throw new Error(`Ciphertext key id ${keyId} does not match the configured key`);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

export function last4(value: string): string {
  const digits = value.replace(/\D/g, '');
  return (digits.length >= 4 ? digits : value).slice(-4).padStart(4, '•');
}
