import { describe, expect, it } from 'vitest';
import { idempotencyKey, UUID_V4 } from './idempotency.js';

describe('idempotencyKey', () => {
  it('uses randomUUID when the runtime has it', () => {
    const key = idempotencyKey({
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      getRandomValues: (a) => a,
    });
    expect(key).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('builds a valid RFC 4122 v4 UUID from getRandomValues when randomUUID is missing', () => {
    const key = idempotencyKey({
      getRandomValues: (a) => {
        a.fill(0xff);
        return a;
      },
    });
    expect(key).toMatch(UUID_V4);
    expect(key).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
  });

  it('produces distinct keys with the ambient crypto', () => {
    const a = idempotencyKey();
    const b = idempotencyKey();
    expect(a).toMatch(UUID_V4);
    expect(a).not.toBe(b);
  });
});
