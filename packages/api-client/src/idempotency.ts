/** The subset of Web Crypto the key generator needs; React Native, browsers and Node all provide it. */
export interface CryptoLike {
  randomUUID?: () => string;
  getRandomValues: <T extends Uint8Array>(array: T) => T;
}

function defaultCrypto(): CryptoLike {
  const c = (globalThis as { crypto?: CryptoLike }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('No Web Crypto implementation available; pass one to idempotencyKey()');
  }
  return c;
}

/**
 * A unique key per mutating request (api.md §7). `crypto.randomUUID` exists only in secure
 * contexts (HTTPS or localhost) and on newer runtimes; everything else gets the RFC 4122 v4
 * fallback built from `getRandomValues`, which is always available.
 */
export function idempotencyKey(cryptoImpl: CryptoLike = defaultCrypto()): string {
  if (typeof cryptoImpl.randomUUID === 'function') return cryptoImpl.randomUUID();
  const b = cryptoImpl.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
