import { describe, expect, it } from 'vitest';
import type { PaymentStatusDto } from '@unigate/types';
import { INITIAL_POLL_STATE, MAX_POLL_ATTEMPTS, paymentOutcome, paymentPollReducer, type PollState } from './payment-poll';

const status = (s: string): PaymentStatusDto => ({ id: 'p1', status: s, paidAt: null, failureCode: s === 'FAILED' ? 'DECLINED' : null, bookingStatus: null });

describe('paymentPollReducer', () => {
  it('keeps polling with a growing, capped delay while the payment is PENDING', () => {
    let s: PollState = INITIAL_POLL_STATE;
    const delays: (number | null)[] = [];
    for (let i = 0; i < 5; i++) {
      s = paymentPollReducer(s, { type: 'result', status: status('PENDING') });
      delays.push(s.nextDelayMs);
    }
    expect(s.phase).toBe('polling');
    expect(delays).toEqual([1000, 2000, 3000, 4000, 5000]);
    for (let i = 0; i < 3; i++) s = paymentPollReducer(s, { type: 'result', status: status('AUTHORIZED') });
    expect(s.nextDelayMs).toBe(8000);
    expect(paymentOutcome(s)).toBe('pending');
  });

  it('settles on PAID and never assumes success before the API says so', () => {
    const s1 = paymentPollReducer(INITIAL_POLL_STATE, { type: 'result', status: status('PENDING') });
    expect(paymentOutcome(s1)).toBe('pending');
    const s2 = paymentPollReducer(s1, { type: 'result', status: status('PAID') });
    expect(s2.phase).toBe('settled');
    expect(s2.nextDelayMs).toBeNull();
    expect(paymentOutcome(s2)).toBe('paid');
  });

  it('settles on FAILED / CANCELLED with the failure outcome', () => {
    expect(paymentOutcome(paymentPollReducer(INITIAL_POLL_STATE, { type: 'result', status: status('FAILED') }))).toBe('failed');
    expect(paymentOutcome(paymentPollReducer(INITIAL_POLL_STATE, { type: 'result', status: status('CANCELLED') }))).toBe('failed');
  });

  it('gives up after the bounded number of attempts and reports pending', () => {
    let s: PollState = INITIAL_POLL_STATE;
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) s = paymentPollReducer(s, { type: 'result', status: status('PENDING') });
    expect(s.phase).toBe('gave-up');
    expect(s.attempt).toBe(MAX_POLL_ATTEMPTS);
    expect(s.nextDelayMs).toBeNull();
    expect(paymentOutcome(s)).toBe('pending');
  });

  it('retries transport failures but stops on a definitive API error', () => {
    const net = paymentPollReducer(INITIAL_POLL_STATE, { type: 'failure', code: 'NETWORK' });
    expect(net.phase).toBe('polling');
    expect(net.nextDelayMs).toBe(1000);
    const gone = paymentPollReducer(net, { type: 'failure', code: 'NOT_FOUND' });
    expect(gone.phase).toBe('error');
    expect(gone.errorCode).toBe('NOT_FOUND');
    expect(paymentOutcome(gone)).toBe('error');
    expect(paymentPollReducer(gone, { type: 'reset' })).toEqual(INITIAL_POLL_STATE);
  });
});
