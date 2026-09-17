import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { chunks, Sha256, sha256Hex, sha256HexChunked, toHex } from './sha256';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('sha256Hex', () => {
  it('matches the FIPS 180-4 known vectors', () => {
    // The `checksumSha256` the API verifies: lower-case hex over the exact bytes.
    expect(sha256Hex(utf8(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(utf8('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(utf8('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with Node\'s crypto for a binary payload spanning many blocks', () => {
    const bytes = new Uint8Array(100_003);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('handles the padding edge cases (55, 56, 63, 64 bytes)', () => {
    for (const n of [55, 56, 63, 64, 119, 120]) {
      const bytes = new Uint8Array(n).fill(0x61);
      expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
  });
});

describe('Sha256 streaming', () => {
  it('gives the same digest whatever the chunk boundaries', () => {
    const bytes = new Uint8Array(70_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 13) & 0xff;
    const expected = sha256Hex(bytes);
    for (const size of [1, 7, 63, 64, 65, 1000, 65_536]) {
      const h = new Sha256();
      for (const part of chunks(bytes, size)) h.update(part);
      expect(toHex(h.digest())).toBe(expected);
    }
  });

  it('refuses to be reused after digest', () => {
    const h = new Sha256().update(utf8('x'));
    h.digest();
    expect(() => h.digest()).toThrow();
    expect(() => h.update(utf8('y'))).toThrow();
  });
});

describe('chunks', () => {
  it('splits into views of at most chunkSize without copying', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const parts = chunks(bytes, 2);
    expect(parts.map((p) => [...p])).toEqual([[1, 2], [3, 4], [5]]);
    expect(parts[0]?.buffer).toBe(bytes.buffer);
    expect(chunks(new Uint8Array(0), 4)).toEqual([]);
    expect(() => chunks(bytes, 0)).toThrow();
  });
});

describe('sha256HexChunked', () => {
  it('reports progress and matches the one-shot digest', async () => {
    const bytes = new Uint8Array(10_000).map((_, i) => i & 0xff);
    const seen: [number, number][] = [];
    const hex = await sha256HexChunked(bytes, (done, total) => seen.push([done, total]), 4096);
    expect(hex).toBe(sha256Hex(bytes));
    expect(seen).toEqual([
      [4096, 10_000],
      [8192, 10_000],
      [10_000, 10_000],
    ]);
  });

  it('reports 0/0 for an empty payload', async () => {
    const seen: [number, number][] = [];
    const hex = await sha256HexChunked(new Uint8Array(0), (done, total) => seen.push([done, total]));
    expect(hex).toBe(sha256Hex(new Uint8Array(0)));
    expect(seen).toEqual([[0, 0]]);
  });
});
