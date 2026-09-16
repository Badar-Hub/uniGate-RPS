import { describe, expect, it } from 'vitest';
import { parseEnvelope } from './envelope.js';

describe('parseEnvelope', () => {
  it('returns ok with no data for 204', () => {
    expect(parseEnvelope({ status: 204, body: undefined })).toEqual({
      ok: true,
      data: undefined,
      meta: {},
    });
  });

  it('unwraps a success envelope with its meta', () => {
    const r = parseEnvelope<{ id: string }[]>({
      status: 200,
      body: {
        success: true,
        data: [{ id: 'a' }],
        message: null,
        meta: {
          page: 1,
          pageSize: 20,
          totalItems: 1,
          totalPages: 1,
          hasNext: false,
          hasPrevious: false,
        },
      },
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual([{ id: 'a' }]);
      expect(r.meta.totalItems).toBe(1);
    }
  });

  it('maps an error envelope to ApiError with code, details and requestId', () => {
    const r = parseEnvelope({
      status: 422,
      body: {
        success: false,
        data: null,
        message: 'Validation failed',
        error: {
          code: 'VALIDATION_FAILED',
          requestId: 'req-1',
          details: { fieldErrors: { 'body.identifier': ['Invalid'] }, formErrors: [] },
        },
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({
        status: 422,
        code: 'VALIDATION_FAILED',
        message: 'Validation failed',
        requestId: 'req-1',
      });
      expect(r.error.details).toEqual({
        fieldErrors: { 'body.identifier': ['Invalid'] },
        formErrors: [],
      });
      expect(r.error.retryAfterSeconds).toBeUndefined();
    }
  });

  it('reads Retry-After from the header, preferring details.retryAfterSeconds', () => {
    const fromHeader = parseEnvelope({
      status: 429,
      retryAfterHeader: '43',
      body: {
        success: false,
        data: null,
        message: 'Slow down',
        error: { code: 'RATE_LIMITED', requestId: 'r' },
      },
    });
    expect(!fromHeader.ok && fromHeader.error.retryAfterSeconds).toBe(43);
    const fromDetails = parseEnvelope({
      status: 429,
      retryAfterHeader: '43',
      body: {
        success: false,
        data: null,
        message: 'Throttled',
        error: {
          code: 'AUTH_OTP_THROTTLED',
          requestId: 'r',
          details: { scope: 'DESTINATION', retryAfterSeconds: 60 },
        },
      },
    });
    expect(!fromDetails.ok && fromDetails.error.retryAfterSeconds).toBe(60);
  });

  it('treats a non-envelope body (proxy HTML, empty 502) as NETWORK', () => {
    const r = parseEnvelope({ status: 502, statusText: 'Bad Gateway', body: undefined });
    expect(r).toEqual({
      ok: false,
      error: { status: 502, code: 'NETWORK', message: 'Bad Gateway' },
    });
    const html = parseEnvelope({ status: 200, body: '<html>' });
    expect(!html.ok && html.error.code).toBe('NETWORK');
  });
});
