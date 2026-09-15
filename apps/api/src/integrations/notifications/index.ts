import { createTransport, type Transporter } from 'nodemailer';
import { config } from '@/config/index.js';
import { logger } from '@/logging/logger.js';
import { maskEmail, maskPhone } from '@/common/redact.js';
import type { DeliveryResult, EmailMessage, EmailProvider, PushMessage, PushProvider, SmsMessage, SmsProvider } from './providers.js';

export type { DeliveryResult, EmailMessage, EmailProvider, PushMessage, PushProvider, SmsMessage, SmsProvider } from './providers.js';

/**
 * Development/staging only: the rendered message goes to stdout so an engineer can read it.
 * The env schema refuses to boot production with a console provider. Bodies may carry
 * one-time links (activation, password reset) — they are printed here exactly as the OTP
 * console provider prints codes: unmistakably a dev artefact, never through the logger.
 */
class ConsoleEmailProvider implements EmailProvider {
  readonly code = 'console';
  async send(m: EmailMessage): Promise<DeliveryResult> {
    if (config().isProduction) throw new Error('ConsoleEmailProvider cannot run in production');
    console.warn(`\n  ┌─ EMAIL → ${maskEmail(m.to)}  [${m.locale}] ${m.subject}\n  │  ${m.text.replace(/\n/g, '\n  │  ')}\n  └─ dev only\n`);
    await Promise.resolve();
    return { providerMessageId: null };
  }
}

/** Real SMTP (nodemailer): MailHog in development (`mailhog`), any relay in staging/production (`smtp`). */
class SmtpEmailProvider implements EmailProvider {
  readonly code: string;
  private readonly transport: Transporter;
  constructor(code: 'mailhog' | 'smtp') {
    this.code = code;
    const { smtp } = config().providers;
    this.transport = createTransport({ host: smtp.host, port: smtp.port, secure: smtp.secure, ...(smtp.user && smtp.password ? { auth: { user: smtp.user, pass: smtp.password } } : {}) });
  }
  async send(m: EmailMessage): Promise<DeliveryResult> {
    const info = await this.transport.sendMail({ from: config().providers.emailFrom, to: m.to, subject: m.subject, text: m.text, ...(m.html ? { html: m.html } : {}) });
    return { providerMessageId: typeof info.messageId === 'string' ? info.messageId : null };
  }
}

class ConsoleSmsProvider implements SmsProvider {
  readonly code = 'console';
  async send(m: SmsMessage): Promise<DeliveryResult> {
    if (config().isProduction) throw new Error('ConsoleSmsProvider cannot run in production');
    console.warn(`\n  ┌─ SMS → ${maskPhone(m.to)}${m.senderId ? ` (from ${m.senderId})` : ''}\n  │  ${m.text}\n  └─ dev only\n`);
    await Promise.resolve();
    return { providerMessageId: null };
  }
}

/** PUSH_PROVIDER=none: the channel is skipped (rows are SUPPRESSED with a reason), tokens are still stored for later. */
class NoPushProvider implements PushProvider {
  readonly code = 'none';
  async send(): Promise<DeliveryResult & { invalidTokens: string[] }> {
    await Promise.resolve();
    throw new Error('PUSH_PROVIDER=none: push delivery is not configured');
  }
}

let email: EmailProvider | null = null;
let sms: SmsProvider | null = null;
let push: PushProvider | null = null;

export function emailProvider(): EmailProvider {
  if (email) return email;
  const c = config().providers.email;
  switch (c) {
    case 'console':
      email = new ConsoleEmailProvider();
      break;
    case 'mailhog':
    case 'smtp':
      email = new SmtpEmailProvider(c);
      break;
    case 'ses':
      throw new Error('EMAIL_PROVIDER=ses is not implemented yet — use smtp with the SES SMTP endpoint');
  }
  return email;
}

export function smsProvider(): SmsProvider {
  if (sms) return sms;
  const c = config().providers.sms;
  if (c === 'console') sms = new ConsoleSmsProvider();
  // The vendor adapter lands with procurement (OQ-10 / B-9). Refusing loudly beats silently not sending.
  else throw new Error(`SMS provider "${c}" is not implemented yet (OQ-10)`);
  return sms;
}

export function pushProvider(): PushProvider {
  if (push) return push;
  const c = config().providers.push;
  if (c === 'none') push = new NoPushProvider();
  else throw new Error('PUSH_PROVIDER=fcm is not implemented yet');
  return push;
}

export function isPushConfigured(): boolean {
  return config().providers.push !== 'none';
}

/** Test seam: capture every delivery in memory instead of touching a transport. */
export class MemoryChannelProviders implements EmailProvider, SmsProvider, PushProvider {
  readonly code = 'memory';
  readonly emails: EmailMessage[] = [];
  readonly sms: SmsMessage[] = [];
  readonly pushes: PushMessage[] = [];
  failNext: string | null = null;
  async send(m: EmailMessage | SmsMessage | PushMessage): Promise<DeliveryResult & { invalidTokens: string[] }> {
    await Promise.resolve();
    if (this.failNext) {
      const msg = this.failNext;
      this.failNext = null;
      throw new Error(msg);
    }
    if ('tokens' in m) this.pushes.push(m);
    else if ('subject' in m) this.emails.push(m);
    else this.sms.push(m);
    return { providerMessageId: `mem-${this.emails.length + this.sms.length + this.pushes.length}`, invalidTokens: [] };
  }
}

export function setChannelProvidersForTests(p: { email?: EmailProvider | null; sms?: SmsProvider | null; push?: PushProvider | null } | null): void {
  email = p?.email ?? null;
  sms = p?.sms ?? null;
  push = p?.push ?? null;
  logger().debug('channel providers replaced for tests');
}
