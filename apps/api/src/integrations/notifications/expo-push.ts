import { logger } from '@/logging/logger.js';
import type { DeliveryResult, PushMessage, PushProvider } from './providers.js';

/**
 * PUSH_PROVIDER=expo — the Expo Push Service (https://docs.expo.dev/push-notifications/sending-notifications/).
 * The mobile app registers `ExponentPushToken[…]` tokens (`POST /notifications/devices`); Expo
 * relays to FCM / APNs with the credentials held in the EAS project, so the API never stores
 * Google or Apple keys. `EXPO_PUSH_ACCESS_TOKEN` (an EAS access token, optional but recommended —
 * it stops third parties from pushing to our tokens) is sent as a bearer.
 *
 * Batching: at most 100 messages per request. Tickets with `DeviceNotRegistered` name tokens that
 * are gone for good — they are returned as `invalidTokens` and the service deactivates them.
 * Other per-ticket errors are logged; the delivery still counts as SENT for the tokens that got a
 * ticket id, mirroring how the SMS/e-mail adapters treat partial provider acceptance.
 * Receipts (delivery to the device) are a later concern; tickets prove acceptance by Expo.
 */
const ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100;

interface ExpoTicket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface ExpoPushOptions {
  accessToken: string | null;
  /** Injected in tests. */
  fetch?: typeof fetch;
  endpoint?: string;
}

export class ExpoPushProvider implements PushProvider {
  readonly code = 'expo';
  private readonly fetchImpl: typeof fetch;
  private readonly endpoint: string;
  constructor(private readonly opts: ExpoPushOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.endpoint = opts.endpoint ?? ENDPOINT;
  }

  async send(message: PushMessage): Promise<DeliveryResult & { invalidTokens: string[] }> {
    const tokens = message.tokens.filter((t) => /^Expo(nent)?PushToken\[.+\]$/.test(t));
    const skipped = message.tokens.length - tokens.length;
    if (skipped > 0) logger().warn({ skipped }, 'expo push: ignoring tokens that are not Expo push tokens');
    if (tokens.length === 0) return { providerMessageId: null, invalidTokens: [] };

    const invalidTokens: string[] = [];
    let firstTicket: string | null = null;
    for (let i = 0; i < tokens.length; i += CHUNK) {
      const batch = tokens.slice(i, i + CHUNK);
      const res = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          ...(this.opts.accessToken ? { Authorization: `Bearer ${this.opts.accessToken}` } : {}),
        },
        body: JSON.stringify(
          batch.map((to) => ({
            to,
            title: message.title,
            body: message.body,
            data: message.data,
            sound: 'default',
            priority: 'high',
            channelId: 'default',
          })),
        ),
      });
      if (!res.ok) throw new Error(`expo push: HTTP ${res.status}`);
      const parsed = (await res.json()) as { data?: ExpoTicket[]; errors?: { code: string; message: string }[] };
      if (parsed.errors?.length) throw new Error(`expo push: ${parsed.errors.map((e) => e.code).join(', ')}`);
      const tickets = parsed.data ?? [];
      tickets.forEach((t, idx) => {
        const token = batch[idx];
        if (t.status === 'ok') {
          firstTicket ??= t.id ?? null;
          return;
        }
        if (t.details?.error === 'DeviceNotRegistered' && token) invalidTokens.push(token);
        else logger().warn({ error: t.details?.error ?? null, message: t.message ?? null }, 'expo push: ticket error');
      });
    }
    return { providerMessageId: firstTicket, invalidTokens };
  }
}
