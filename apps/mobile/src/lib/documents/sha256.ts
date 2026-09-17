/**
 * Streaming SHA-256 (FIPS 180-4) in plain JavaScript. The API verifies `checksumSha256` — the
 * lower-case hex digest over the exact bytes it finds in the object store — before it accepts a
 * document (api.md §8.10 `POST /documents/{id}/confirm`), so the device must produce the same
 * value the web portal's `sha256Bytes` produces. The hasher takes chunks so a large PDF can be
 * fed from a file stream without holding a second copy of the bytes; `sha256Hex(bytes)` is the
 * one-shot form. Byte-identical to WebCrypto and to `expo-crypto`'s native digest.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

/** Incremental hasher: `update()` any number of chunks of any size, then `digest()` once. */
export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly view = new DataView(this.block.buffer);
  private readonly w = new Uint32Array(64);
  private blockLength = 0;
  private totalBytes = 0;
  private finished = false;

  update(chunk: Uint8Array): this {
    if (this.finished) throw new Error('Sha256: update after digest');
    let offset = 0;
    this.totalBytes += chunk.length;
    while (offset < chunk.length) {
      const take = Math.min(64 - this.blockLength, chunk.length - offset);
      this.block.set(chunk.subarray(offset, offset + take), this.blockLength);
      this.blockLength += take;
      offset += take;
      if (this.blockLength === 64) {
        this.compress();
        this.blockLength = 0;
      }
    }
    return this;
  }

  /** The 32-byte digest. The instance cannot be reused afterwards. */
  digest(): Uint8Array {
    if (this.finished) throw new Error('Sha256: digest called twice');
    this.finished = true;
    const bitLength = this.totalBytes * 8;
    this.block[this.blockLength++] = 0x80;
    if (this.blockLength > 56) {
      this.block.fill(0, this.blockLength);
      this.compress();
      this.blockLength = 0;
    }
    this.block.fill(0, this.blockLength, 56);
    // Message length as a 64-bit big-endian integer; JS numbers are exact up to 2^53 bits.
    this.view.setUint32(56, Math.floor(bitLength / 0x1_0000_0000), false);
    this.view.setUint32(60, bitLength >>> 0, false);
    this.compress();
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, this.h[i] ?? 0, false);
    return out;
  }

  private compress(): void {
    const { w, view, h } = this;
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(i * 4, false);
    for (let i = 16; i < 64; i++) {
      const w15 = w[i - 15] ?? 0;
      const w2 = w[i - 2] ?? 0;
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      w[i] = ((w[i - 16] ?? 0) + s0 + (w[i - 7] ?? 0) + s1) >>> 0;
    }
    let a = h[0] ?? 0;
    let b = h[1] ?? 0;
    let c = h[2] ?? 0;
    let d = h[3] ?? 0;
    let e = h[4] ?? 0;
    let f = h[5] ?? 0;
    let g = h[6] ?? 0;
    let hh = h[7] ?? 0;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + (K[i] ?? 0) + (w[i] ?? 0)) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    const add = [a, b, c, d, e, f, g, hh];
    for (let i = 0; i < 8; i++) h[i] = ((h[i] ?? 0) + (add[i] ?? 0)) >>> 0;
  }
}

export function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** One-shot digest of `bytes` as lower-case hex — the `checksumSha256` wire format. */
export function sha256Hex(bytes: Uint8Array): string {
  return toHex(new Sha256().update(bytes).digest());
}

/**
 * Splits `bytes` into views of at most `chunkSize` bytes (no copies), so a large file can be
 * hashed with progress reporting between chunks and the UI thread gets to breathe.
 */
export function chunks(bytes: Uint8Array, chunkSize: number): Uint8Array[] {
  if (chunkSize <= 0) throw new Error('chunkSize must be positive');
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    out.push(bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return out;
}

export const DEFAULT_CHUNK_SIZE = 256 * 1024;

/**
 * Hashes `bytes` chunk by chunk, yielding to the event loop between chunks and reporting the
 * bytes hashed so far. Same digest as `sha256Hex`, whatever the chunk boundaries.
 */
export async function sha256HexChunked(
  bytes: Uint8Array,
  onProgress?: (hashedBytes: number, totalBytes: number) => void,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): Promise<string> {
  const hasher = new Sha256();
  let done = 0;
  for (const part of chunks(bytes, chunkSize)) {
    hasher.update(part);
    done += part.length;
    onProgress?.(done, bytes.length);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (bytes.length === 0) onProgress?.(0, 0);
  return toHex(hasher.digest());
}
