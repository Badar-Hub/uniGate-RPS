/**
 * Channel provider ports (FR-NOTIFICATIONS-01, architecture.md §5.4). Provider CHOICE is
 * deployment configuration (EMAIL_PROVIDER / SMS_PROVIDER / PUSH_PROVIDER); what is sent, to
 * whom and when is the notifications module's business (templates + settings). Adapters never
 * see a template — they receive rendered text.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string | undefined;
  locale: 'ar' | 'en';
}
export interface SmsMessage {
  to: string;
  text: string;
  senderId: string | null;
}
export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
}
export interface DeliveryResult {
  providerMessageId: string | null;
}

export interface EmailProvider {
  readonly code: string;
  send(message: EmailMessage): Promise<DeliveryResult>;
}
export interface SmsProvider {
  readonly code: string;
  send(message: SmsMessage): Promise<DeliveryResult>;
}
export interface PushProvider {
  readonly code: string;
  /** Returns the tokens the provider reported as dead so the service can deactivate them. */
  send(message: PushMessage): Promise<DeliveryResult & { invalidTokens: string[] }>;
}
