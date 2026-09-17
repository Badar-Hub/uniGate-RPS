import type { PaymentStatusDto } from '@unigate/types';

/**
 * The return-from-checkout poller as a pure reducer (api.md §8.17 `GET /payments/{id}/status`,
 * §10: the client never assumes success from the return itself). Mirrors the web's bounded
 * backoff — 1 s, 2 s, 3 s … capped at 8 s, at most 9 attempts (~45 s) — then gives up and tells
 * the customer the booking keeps checking on reload.
 */

/** `PAYMENT_STATUS` values that end polling (`@unigate/types` PAYMENT_STATUS). */
export const TERMINAL_PAYMENT_STATUSES: readonly string[] = [
  'PAID',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];

export const MAX_POLL_ATTEMPTS = 9;
export const MAX_POLL_DELAY_MS = 8000;

export interface PollState {
  phase: 'polling' | 'settled' | 'gave-up' | 'error';
  attempt: number;
  last: PaymentStatusDto | null;
  /** Delay before the next status read; null when polling has stopped. */
  nextDelayMs: number | null;
  errorCode: string | null;
}

export type PollEvent =
  | { type: 'result'; status: PaymentStatusDto }
  | { type: 'failure'; code: string }
  | { type: 'reset' };

export const INITIAL_POLL_STATE: PollState = {
  phase: 'polling',
  attempt: 0,
  last: null,
  nextDelayMs: 0,
  errorCode: null,
};

export function isTerminalPaymentStatus(status: string): boolean {
  return TERMINAL_PAYMENT_STATUSES.includes(status);
}

export function nextDelayMs(attempt: number): number {
  return Math.min(1000 * attempt, MAX_POLL_DELAY_MS);
}

export function paymentPollReducer(state: PollState, event: PollEvent): PollState {
  switch (event.type) {
    case 'reset':
      return INITIAL_POLL_STATE;
    case 'result': {
      if (isTerminalPaymentStatus(event.status.status)) {
        return { phase: 'settled', attempt: state.attempt + 1, last: event.status, nextDelayMs: null, errorCode: null };
      }
      const attempt = state.attempt + 1;
      if (attempt >= MAX_POLL_ATTEMPTS) {
        return { phase: 'gave-up', attempt, last: event.status, nextDelayMs: null, errorCode: null };
      }
      return { phase: 'polling', attempt, last: event.status, nextDelayMs: nextDelayMs(attempt), errorCode: null };
    }
    case 'failure': {
      // A 404 / PERM_DENIED will not fix itself; a transport blip is retried like a pending read.
      if (event.code !== 'NETWORK' && event.code !== 'RATE_LIMITED') {
        return { phase: 'error', attempt: state.attempt + 1, last: state.last, nextDelayMs: null, errorCode: event.code };
      }
      const attempt = state.attempt + 1;
      if (attempt >= MAX_POLL_ATTEMPTS) {
        return { phase: 'gave-up', attempt, last: state.last, nextDelayMs: null, errorCode: event.code };
      }
      return { phase: 'polling', attempt, last: state.last, nextDelayMs: nextDelayMs(attempt), errorCode: event.code };
    }
    default:
      return state;
  }
}

/** The outcome the return screen shows once polling has stopped (or while it runs). */
export type PaymentOutcome = 'paid' | 'failed' | 'pending' | 'error';

export function paymentOutcome(state: PollState): PaymentOutcome {
  if (state.phase === 'error') return 'error';
  const s = state.last?.status;
  if (s === 'PAID') return 'paid';
  if (s === 'FAILED' || s === 'CANCELLED') return 'failed';
  return 'pending';
}
