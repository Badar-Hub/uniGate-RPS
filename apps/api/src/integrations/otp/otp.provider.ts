import type { OtpChannel, OtpPurpose } from '@unigate/types';
import { config } from '@/config/index.js';
import { logger } from '@/logging/logger.js';
import { maskEmail, maskPhone } from '@/common/redact.js';
import { emailProvider } from '@/integrations/notifications/index.js';

/**
 * OtpProvider (architecture.md §5.4). Provider CHOICE is deployment configuration
 * (OTP_PROVIDER); behaviour (length, TTL, attempts) is settings. The production adapter is
 * added when UniGate procures an SMS provider and a CST sender id (blocker B-9).
 */
export interface OtpProvider {
  readonly code: string;
  send(input: { channel: OtpChannel; destination: string; code: string; purpose: OtpPurpose; locale: 'ar' | 'en' }): Promise<void>;
}

/**
 * Development/staging only. Prints the code to stdout. The env schema refuses to boot a
 * production build with OTP_PROVIDER=console, and the code is never written through the
 * logger (which would redact it anyway) — it goes to console.warn so it is unmistakably a
 * dev artefact.
 */
export class ConsoleOtpProvider implements OtpProvider {
  readonly code = 'console';
  async send(input: { channel: OtpChannel; destination: string; code: string; purpose: OtpPurpose; locale: 'ar' | 'en' }): Promise<void> {
    if (config().isProduction) throw new Error('ConsoleOtpProvider cannot run in production');
    const masked = input.channel === 'SMS' ? maskPhone(input.destination) : maskEmail(input.destination);
    console.warn(`\n  ┌─ OTP (${input.purpose}) → ${masked}\n  │  ${input.code}\n  └─ dev only\n`);
    logger().info({ purpose: input.purpose, channel: input.channel }, 'otp dispatched via console provider');
    // Dev convenience: mirror every code into the catch-all mailbox (MailHog) so testers never need the log.
    try {
      await emailProvider().send({ to: 'otp-mirror@unigate.local', subject: `[dev] OTP ${input.purpose} for ${masked}: ${input.code}`, text: `One-time code for ${masked} (${input.purpose}): ${input.code}\n\nThis mirror exists only with the console OTP provider and never runs in production.`, locale: input.locale });
    } catch (err) {
      logger().warn({ err }, 'otp mailbox mirror failed (the console output above still applies)');
    }
  }
}

let instance: OtpProvider | null = null;

export function otpProvider(): OtpProvider {
  if (instance) return instance;
  switch (config().providers.otp) {
    case 'console':
      instance = new ConsoleOtpProvider();
      break;
    case 'unifonic':
    case 'taqnyat':
    case 'msegat':
    case 'twilio':
      // Adapter lands with procurement (B-9). Refusing loudly beats silently not sending.
      throw new Error(`OTP provider "${config().providers.otp}" is not implemented yet (B-9)`);
  }
  return instance;
}

/** Test seam. */
export function setOtpProviderForTests(p: OtpProvider | null): void {
  instance = p;
}
