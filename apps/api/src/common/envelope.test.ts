import { describe, expect, it } from 'vitest';
import { fail, ok, paginated } from './envelope.js';

describe('envelope', () => {
  it('success shape', () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 }, message: null, meta: {} });
  });
  it('pagination meta', () => {
    const e = paginated([1, 2], 2, 20, 137);
    expect(e.meta).toEqual({ page: 2, pageSize: 20, totalItems: 137, totalPages: 7, hasNext: true, hasPrevious: true });
  });
  it('error details are absent, not null, when omitted', () => {
    const e = fail('NOT_FOUND', 'x', 'rid');
    expect('details' in e.error).toBe(false);
    expect(e.error.requestId).toBe('rid');
  });
});
