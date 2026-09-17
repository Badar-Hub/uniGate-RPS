import { describe, expect, it, vi } from 'vitest';
import { idempotencyKey, UUID_V4 } from '@unigate/api-client';
import type { CryptoLike } from './crypto-shim';

vi.mock('expo-crypto', () => ({
  getRandomValues: <T extends ArrayBufferView | null>(a: T) => {
    if (a instanceof Uint8Array) for (let i = 0; i < a.length; i++) a[i] = (i * 37 + 11) & 0xff;
    return a;
  },
  randomUUID: () => '11111111-2222-4333-8444-555555555555',
}));

describe('crypto shim', () => {
  it('provides getRandomValues and randomUUID on a runtime without Web Crypto, and leaves a real one alone', async () => {
    const { installCryptoShim } = await import('./crypto-shim');
    const bare: { crypto?: CryptoLike } = {};
    const c = installCryptoShim(bare);
    expect(typeof c.getRandomValues).toBe('function');
    expect(c.randomUUID?.()).toBe('11111111-2222-4333-8444-555555555555');
    expect(idempotencyKey(c as Parameters<typeof idempotencyKey>[0])).toMatch(UUID_V4);

    const real = { getRandomValues: vi.fn(<T,>(a: T) => a) };
    const target = { crypto: real };
    installCryptoShim(target);
    expect(target.crypto.getRandomValues).toBe(real.getRandomValues);
    expect(typeof (target.crypto as { randomUUID?: unknown }).randomUUID).toBe('function');
  });
});
