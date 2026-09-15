import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentMethodType } from '@unigate/types';
import { GatewayError, type CreatePaymentRequest, type CreatePaymentResult, type GatewayPaymentStatus, type PaymentGateway, type RefundRequest, type RefundResult, type WebhookEvent, type WebhookVerification } from './gateway.js';

/**
 * The development gateway (ADR-005): a real implementation of the full port, not a stub. The
 * hosted checkout is the web app's own /pay/mock page; its outcome is driven through the
 * dev-only `POST /payments/mock/checkout/{providerPaymentId}`, which makes this gateway emit an
 * HMAC-signed webhook to the API's real webhook route — so signature verification, persist-first,
 * duplicate delivery, out-of-order delivery and failure branches are all exercised end to end.
 *
 * Environment validation refuses to boot production with PAYMENT_PROVIDER=mock.
 */

const METHODS: readonly PaymentMethodType[] = ['MADA', 'VISA', 'MASTERCARD', 'STC_PAY', 'APPLE_PAY', 'BANK_TRANSFER'];
const REPLAY_WINDOW_MS = 5 * 60_000;

interface Session {
  providerPaymentId: string;
  paymentId: string;
  amount: string;
  currency: string;
  methodType: PaymentMethodType;
  state: GatewayPaymentStatus['state'];
  last4: string | null;
  paidAt: Date | null;
  failureCode: string | null;
  expiresAt: Date;
  transactionId: string | null;
}

interface MockRefund {
  providerRefundId: string;
  providerPaymentId: string;
  amount: string;
  state: 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

export interface SignedWebhook {
  headers: Record<string, string>;
  body: Buffer;
}

export class MockGateway implements PaymentGateway {
  readonly code = 'mock';
  readonly supportedMethods = METHODS;
  readonly publishableKey = null;
  private readonly sessions = new Map<string, Session>();
  private readonly refunds = new Map<string, MockRefund>();

  constructor(
    private readonly opts: { checkoutBaseUrl: string; webhookSecret: string; sessionMinutes?: number },
  ) {}

  async createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult> {
    await Promise.resolve();
    if (!METHODS.includes(req.methodType)) throw new GatewayError(this.code, `method ${req.methodType} is not supported by the mock gateway`);
    const providerPaymentId = `mock_pay_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const expiresAt = new Date(Date.now() + (this.opts.sessionMinutes ?? 30) * 60_000);
    this.sessions.set(providerPaymentId, { providerPaymentId, paymentId: req.paymentId, amount: req.amount, currency: req.currency, methodType: req.methodType, state: 'PENDING', last4: null, paidAt: null, failureCode: null, expiresAt, transactionId: null });
    // BANK_TRANSFER has no hosted page: it stays PENDING until ops reconciles it (api.md §6.4).
    const action: CreatePaymentResult['action'] = req.methodType === 'BANK_TRANSFER'
      ? { type: 'NONE', url: null, method: null, fields: null, clientPayload: { reference: req.paymentNumber } }
      : { type: 'REDIRECT', url: `${this.opts.checkoutBaseUrl}/${providerPaymentId}?return=${encodeURIComponent(req.returnUrl)}`, method: 'GET', fields: null, clientPayload: null };
    return { providerPaymentId, action, expiresAt, requestRedacted: { amount: req.amount, currency: req.currency, methodType: req.methodType, description: req.description }, responseRedacted: { providerPaymentId, action: action.type } };
  }

  async getPaymentStatus(providerPaymentId: string): Promise<GatewayPaymentStatus> {
    await Promise.resolve();
    const s = this.sessions.get(providerPaymentId);
    if (!s) throw new GatewayError(this.code, `unknown payment ${providerPaymentId}`, { providerPaymentId });
    return { providerPaymentId, state: s.state, amount: s.amount, currency: s.currency, methodType: s.methodType, last4: s.last4, paidAt: s.paidAt, failureCode: s.failureCode, failureMessage: s.failureCode ? 'declined by the mock gateway' : null, providerTransactionId: s.transactionId, responseRedacted: { state: s.state } };
  }

  async refundPayment(req: RefundRequest): Promise<RefundResult> {
    await Promise.resolve();
    const s = this.sessions.get(req.providerPaymentId);
    if (s?.state !== 'PAID') throw new GatewayError(this.code, 'payment is not captured', { providerPaymentId: req.providerPaymentId });
    const providerRefundId = `mock_ref_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
    this.refunds.set(providerRefundId, { providerRefundId, providerPaymentId: req.providerPaymentId, amount: req.amount, state: 'PROCESSING' });
    return { providerRefundId, state: 'PROCESSING', responseRedacted: { providerRefundId } };
  }

  // ── webhooks ───────────────────────────────────────────────────────────────

  private sign(timestamp: string, body: Buffer): string {
    return createHmac('sha256', this.opts.webhookSecret).update(`${timestamp}.`).update(body).digest('hex');
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookVerification {
    const header = headers['x-signature'] ?? '';
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
    const ts = parts['t'];
    const v1 = parts['v1'];
    if (!ts || !v1) return { valid: false, withinReplayWindow: true, reason: 'missing signature' };
    const expected = Buffer.from(this.sign(ts, rawBody), 'hex');
    const given = Buffer.from(v1, 'hex');
    const valid = expected.length === given.length && timingSafeEqual(expected, given);
    const withinReplayWindow = Math.abs(Date.now() - Number(ts) * 1000) <= REPLAY_WINDOW_MS;
    return { valid, withinReplayWindow, reason: valid ? (withinReplayWindow ? null : 'outside replay window') : 'signature mismatch' };
  }

  parseWebhook(rawBody: Buffer): WebhookEvent {
    const raw = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    const str = (k: string): string | null => {
      const v = raw[k];
      return typeof v === 'string' ? v : null;
    };
    const type = str('type');
    const occurredAt = str('occurredAt');
    const known: WebhookEvent['type'][] = ['payment.authorized', 'payment.captured', 'payment.failed', 'payment.cancelled', 'refund.completed', 'refund.failed'];
    return {
      eventId: str('id') ?? '',
      type: known.includes(type as WebhookEvent['type']) ? (type as WebhookEvent['type']) : 'unknown',
      providerPaymentId: str('paymentId'),
      providerRefundId: str('refundId'),
      providerTransactionId: str('transactionId'),
      amount: str('amount'),
      currency: str('currency'),
      methodType: (str('methodType') as PaymentMethodType | null) ?? null,
      last4: str('last4'),
      failureCode: str('failureCode'),
      failureMessage: str('failureMessage'),
      occurredAt: occurredAt ? new Date(occurredAt) : new Date(),
      raw,
    };
  }

  /** Build a signed delivery for a neutral event — what the provider's servers would send. */
  signedWebhook(payload: Record<string, unknown>, at = new Date()): SignedWebhook {
    const body = Buffer.from(JSON.stringify({ id: `evt_${randomUUID().replace(/-/g, '').slice(0, 16)}`, occurredAt: at.toISOString(), ...payload }), 'utf8');
    const ts = String(Math.floor(at.getTime() / 1000));
    return { headers: { 'content-type': 'application/json', 'x-signature': `t=${ts},v1=${this.sign(ts, body)}`, 'x-event-id': (JSON.parse(body.toString('utf8')) as { id: string }).id }, body };
  }

  // ── scripting (development / tests) ────────────────────────────────────────

  /** Drive a checkout to an outcome; returns the webhook(s) the provider would deliver. */
  simulateCheckout(providerPaymentId: string, outcome: 'SUCCESS' | 'DECLINE' | 'AUTHORIZE_ONLY', last4 = '4242'): SignedWebhook[] {
    const s = this.sessions.get(providerPaymentId);
    if (!s) throw new GatewayError(this.code, `unknown payment ${providerPaymentId}`);
    if (s.state !== 'PENDING' && s.state !== 'AUTHORIZED') throw new GatewayError(this.code, `payment is already ${s.state}`);
    const now = new Date();
    const base = { paymentId: s.providerPaymentId, amount: s.amount, currency: s.currency, methodType: s.methodType };
    if (outcome === 'DECLINE') {
      s.state = 'FAILED';
      s.failureCode = 'DO_NOT_HONOR';
      return [this.signedWebhook({ type: 'payment.failed', ...base, failureCode: 'DO_NOT_HONOR', failureMessage: 'declined by the mock gateway' }, now)];
    }
    s.last4 = last4;
    s.transactionId = `mock_txn_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    if (outcome === 'AUTHORIZE_ONLY') {
      s.state = 'AUTHORIZED';
      return [this.signedWebhook({ type: 'payment.authorized', ...base, last4, transactionId: s.transactionId }, now)];
    }
    s.state = 'PAID';
    s.paidAt = now;
    return [this.signedWebhook({ type: 'payment.captured', ...base, last4, transactionId: s.transactionId }, now)];
  }

  /** Complete or fail a refund the way the provider's async settlement would. */
  simulateRefund(providerRefundId: string, outcome: 'COMPLETED' | 'FAILED'): SignedWebhook {
    const r = this.refunds.get(providerRefundId);
    if (!r) throw new GatewayError(this.code, `unknown refund ${providerRefundId}`);
    r.state = outcome;
    return this.signedWebhook({ type: outcome === 'COMPLETED' ? 'refund.completed' : 'refund.failed', refundId: providerRefundId, paymentId: r.providerPaymentId, amount: r.amount, ...(outcome === 'FAILED' ? { failureCode: 'REFUND_REJECTED' } : {}) });
  }

  /** Mark a session as authoritatively captured without any webhook — what /sync is for. */
  settleSilently(providerPaymentId: string, last4 = '4242'): void {
    const s = this.sessions.get(providerPaymentId);
    if (!s) throw new GatewayError(this.code, `unknown payment ${providerPaymentId}`);
    s.state = 'PAID';
    s.paidAt = new Date();
    s.last4 = last4;
    s.transactionId = `mock_txn_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
}
