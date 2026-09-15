import { describe, expect, it } from 'vitest';
import { isBannedKey, maskEmail, maskPhone, redact, REDACTED } from './redact.js';

describe('redact()', () => {
  it('strips every banned key from a nested fixture', () => {
    const input = {
      user: { email: 'a@b.co', password: 'x', passwordHash: 'h', profile: { nationalId: '1', iban: 'SA00' } },
      headers: { authorization: 'Bearer t', cookie: 'sid=1', 'x-request-id': 'r1' },
      payment: { pan: '4111', cvv: '123', providerToken: 'tok', amount: '10.00' },
      otp: { code: '123456', codeHash: 'h' },
      verification: { code: '123456', codeHash: 'h' },
      list: [{ token: 't' }, { safe: 1 }],
      env: { DATABASE_URL: 'postgres://', STORAGE_SECRET_KEY: 'k' },
    };
    const out = redact(input);
    expect(out.user.password).toBe(REDACTED);
    expect(out.user.passwordHash).toBe(REDACTED);
    expect(out.user.profile.nationalId).toBe(REDACTED);
    expect(out.user.profile.iban).toBe(REDACTED);
    expect(out.headers.authorization).toBe(REDACTED);
    expect(out.headers.cookie).toBe(REDACTED);
    expect(out.headers['x-request-id']).toBe('r1');
    expect(out.payment.pan).toBe(REDACTED);
    expect(out.payment.cvv).toBe(REDACTED);
    expect(out.payment.providerToken).toBe(REDACTED);
    expect(out.payment.amount).toBe('10.00');
    expect(out.otp).toBe(REDACTED); // the `otp` container key is itself banned
    expect(out.verification.code).toBe(REDACTED);
    expect(out.verification.codeHash).toBe(REDACTED);
    expect(out.list[0]?.token).toBe(REDACTED);
    expect(out.list[1]?.safe).toBe(1);
    expect(out.env.DATABASE_URL).toBe(REDACTED);
    expect(out.env.STORAGE_SECRET_KEY).toBe(REDACTED);
    // never mutates input
    expect(input.user.password).toBe('x');
  });

  it('catches a NEWLY ADDED *_encrypted / *_blind_index column by pattern, not by list', () => {
    expect(isBannedKey('passport_number_encrypted')).toBe(true);
    expect(isBannedKey('passportNumberEncrypted')).toBe(true);
    expect(isBannedKey('passport_number_blind_index')).toBe(true);
    expect(isBannedKey('passportNumberBlindIndex')).toBe(true);
    expect(isBannedKey('passport_number_last4')).toBe(false);
  });

  it('survives cycles and depth', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a['self'] = a;
    expect(() => redact(a)).not.toThrow();
    expect((redact(a) as { self: unknown }).self).toBe('[Circular]');
  });

  it('masks phones and emails', () => {
    expect(maskPhone('+966512345612')).toBe('+9665•• ••• •12');
    expect(maskEmail('badar@example.com')).toBe('b•••@example.com');
  });
});
