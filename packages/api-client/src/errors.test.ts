import { describe, expect, it } from 'vitest';
import type { ApiError } from './envelope.js';
import {
  errorMessage,
  errorMessageKey,
  fieldErrors,
  isThrottled,
  unmappedFieldErrors,
} from './errors.js';

const validation: ApiError = {
  status: 422,
  code: 'VALIDATION_FAILED',
  message: 'Validation failed',
  details: {
    fieldErrors: {
      'body.plateNumberEn': ['Required', 'Too short'],
      'query.page': ['Must be ≥ 1'],
      'params.id': ['Not a uuid'],
      bare: ['Kept as is'],
      empty: [],
    },
    formErrors: [],
  },
};

describe('fieldErrors', () => {
  it('strips body./query./params. prefixes and keeps the first message', () => {
    expect(fieldErrors(validation)).toEqual({
      plateNumberEn: 'Required',
      page: 'Must be ≥ 1',
      id: 'Not a uuid',
      bare: 'Kept as is',
    });
  });
  it('is empty for null, network and non-validation errors', () => {
    expect(fieldErrors(null)).toEqual({});
    expect(fieldErrors({ status: 0, code: 'NETWORK', message: 'x' })).toEqual({});
    expect(
      fieldErrors({ status: 409, code: 'CONFLICT', message: 'x', details: { vertical: 'GOODS' } }),
    ).toEqual({});
  });
});

describe('unmappedFieldErrors', () => {
  it('lists only the fields the form does not know', () => {
    expect(unmappedFieldErrors(validation, ['plateNumberEn', 'page'])).toBe(
      'id: Not a uuid · bare: Kept as is',
    );
    expect(unmappedFieldErrors(validation, ['plateNumberEn', 'page', 'id', 'bare'])).toBe('');
  });
});

describe('errorMessageKey', () => {
  it('maps null → generic and NETWORK → network', () => {
    expect(errorMessageKey(null).key).toBe('errors.generic');
    expect(errorMessageKey({ status: 0, code: 'NETWORK', message: '' })).toEqual({
      key: 'errors.network',
      fallbacks: ['errors.generic'],
    });
  });
  it('maps a code to errors.<CODE>', () => {
    expect(errorMessageKey({ status: 401, code: 'AUTH_INVALID_CREDENTIALS', message: '' })).toEqual(
      { key: 'errors.AUTH_INVALID_CREDENTIALS', fallbacks: ['errors.generic'] },
    );
  });
  it('uses the _VERTICAL variant when details.vertical is present', () => {
    expect(
      errorMessageKey({
        status: 422,
        code: 'DRIVER_NOT_APPROVED',
        message: '',
        details: { vertical: 'GOODS' },
      }),
    ).toEqual({
      key: 'errors.DRIVER_NOT_APPROVED_VERTICAL',
      fallbacks: ['errors.DRIVER_NOT_APPROVED', 'errors.generic'],
      values: { vertical: 'GOODS' },
    });
  });
});

describe('errorMessage', () => {
  const catalogue: Record<string, string> = {
    'errors.generic': 'Something went wrong.',
    'errors.network': 'Cannot reach the server.',
    'errors.AUTH_INVALID_CREDENTIALS': 'Wrong identifier or password.',
    'errors.DRIVER_NOT_APPROVED': 'The driver is not approved.',
    'errors.DRIVER_NOT_APPROVED_VERTICAL': 'The driver is not approved for {vertical} transport.',
    'vertical.GOODS': 'goods',
  };
  const i18n = {
    t: (key: string, values?: Record<string, string | number>) => {
      const raw = catalogue[key] ?? key;
      return Object.entries(values ?? {}).reduce(
        (s, [k, v]) => s.replace(`{${k}}`, String(v)),
        raw,
      );
    },
    has: (key: string) => key in catalogue,
  };

  it('translates known codes, and falls back to generic for unknown ones', () => {
    expect(errorMessage(i18n, { status: 401, code: 'AUTH_INVALID_CREDENTIALS', message: '' })).toBe(
      'Wrong identifier or password.',
    );
    expect(errorMessage(i18n, { status: 500, code: 'SOMETHING_NEW', message: '' })).toBe(
      'Something went wrong.',
    );
    expect(errorMessage(i18n, null)).toBe('Something went wrong.');
  });
  it('interpolates the translated vertical name into the _VERTICAL variant', () => {
    expect(
      errorMessage(i18n, {
        status: 422,
        code: 'DRIVER_NOT_APPROVED',
        message: '',
        details: { vertical: 'GOODS' },
      }),
    ).toBe('The driver is not approved for goods transport.');
  });
  it('falls back from the _VERTICAL variant to the plain code when the variant is missing', () => {
    expect(
      errorMessage(i18n, {
        status: 422,
        code: 'OWNER_NOT_APPROVED',
        message: '',
        details: { vertical: 'GOODS' },
      }),
    ).toBe('Something went wrong.');
    const withPlain = {
      ...i18n,
      has: (k: string) => k in catalogue || k === 'errors.OWNER_NOT_APPROVED',
      t: (k: string) => (k === 'errors.OWNER_NOT_APPROVED' ? 'Owner not approved.' : i18n.t(k)),
    };
    expect(
      errorMessage(withPlain, {
        status: 422,
        code: 'OWNER_NOT_APPROVED',
        message: '',
        details: { vertical: 'GOODS' },
      }),
    ).toBe('Owner not approved.');
  });
  it('detects missing keys by echo when the translator has no `has`', () => {
    expect(errorMessage({ t: i18n.t }, { status: 500, code: 'UNKNOWN', message: '' })).toBe(
      'Something went wrong.',
    );
  });
});

describe('isThrottled', () => {
  it('is true for 429s and the OTP throttle codes', () => {
    expect(isThrottled({ status: 429, code: 'RATE_LIMITED', message: '' })).toBe(true);
    expect(isThrottled({ status: 429, code: 'AUTH_OTP_THROTTLED', message: '' })).toBe(true);
    expect(isThrottled({ status: 401, code: 'AUTH_INVALID_CREDENTIALS', message: '' })).toBe(false);
    expect(isThrottled(null)).toBe(false);
  });
});
