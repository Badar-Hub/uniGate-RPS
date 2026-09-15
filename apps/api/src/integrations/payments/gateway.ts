/**
 * The PaymentGateway port (ADR-005). No provider SDK type appears in any service signature; the
 * active adapter is selected by configuration. The production adapter is written once UniGate
 * chooses a provider (OQ-03) — until then only the development MockGateway exists.
 */
import type { PaymentMethodType } from '@unigate/types';

export interface CreatePaymentRequest {
  paymentId: string;
  paymentNumber: string;
  amount: string;
  currency: string;
  methodType: PaymentMethodType;
  savedToken: string | null;
  returnUrl: string;
  description: string;
  customerRef: string;
  metadata: Record<string, string>;
}

export interface GatewayAction {
  type: 'REDIRECT' | 'FORM_POST' | 'SDK' | 'NONE';
  url: string | null;
  method: 'GET' | 'POST' | null;
  fields: Record<string, string> | null;
  clientPayload: Record<string, unknown> | null;
}

export interface CreatePaymentResult {
  providerPaymentId: string;
  action: GatewayAction;
  expiresAt: Date | null;
  /** Already-redacted request/response fragments for payment_transactions. */
  requestRedacted: Record<string, unknown>;
  responseRedacted: Record<string, unknown>;
}

export type GatewayPaymentState = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'CANCELLED';

export interface GatewayPaymentStatus {
  providerPaymentId: string;
  state: GatewayPaymentState;
  amount: string | null;
  currency: string | null;
  methodType: PaymentMethodType | null;
  last4: string | null;
  paidAt: Date | null;
  failureCode: string | null;
  failureMessage: string | null;
  providerTransactionId: string | null;
  responseRedacted: Record<string, unknown>;
}

export interface RefundRequest {
  refundId: string;
  refundNumber: string;
  providerPaymentId: string;
  amount: string;
  currency: string;
  reason: string;
}

export interface RefundResult {
  providerRefundId: string;
  /** Most providers answer asynchronously; the terminal state arrives by webhook. */
  state: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  responseRedacted: Record<string, unknown>;
}

export interface WebhookVerification {
  valid: boolean;
  /** False when the timestamp is outside the ±5 minute replay window (still stored, never processed). */
  withinReplayWindow: boolean;
  reason: string | null;
}

/** The provider-neutral shape the processor works with. */
export interface WebhookEvent {
  eventId: string;
  type: 'payment.authorized' | 'payment.captured' | 'payment.failed' | 'payment.cancelled' | 'refund.completed' | 'refund.failed' | 'unknown';
  providerPaymentId: string | null;
  providerRefundId: string | null;
  providerTransactionId: string | null;
  amount: string | null;
  currency: string | null;
  methodType: PaymentMethodType | null;
  last4: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  occurredAt: Date;
  raw: Record<string, unknown>;
}

export class GatewayError extends Error {
  constructor(
    readonly providerCode: string,
    message: string,
    readonly responseRedacted: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface PaymentGateway {
  readonly code: string;
  readonly supportedMethods: readonly PaymentMethodType[];
  readonly publishableKey: string | null;
  createPayment(req: CreatePaymentRequest): Promise<CreatePaymentResult>;
  getPaymentStatus(providerPaymentId: string): Promise<GatewayPaymentStatus>;
  refundPayment(req: RefundRequest): Promise<RefundResult>;
  /** Signature over the raw body (api.md §10); constant-time compare. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): WebhookVerification;
  /** Provider payload → neutral event. Throws on an unparseable body. */
  parseWebhook(rawBody: Buffer): WebhookEvent;
}
