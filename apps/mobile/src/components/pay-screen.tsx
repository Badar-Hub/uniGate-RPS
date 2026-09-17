import { useState } from 'react';
import { Text, View } from 'react-native';
import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { idempotencyKey } from '@unigate/api-client';
import type { CreatePaymentResultDto, PaymentActionDto, PaymentDto } from '@unigate/types';
import { SelectField } from '@/components/select-field';
import {
  Button,
  Card,
  ErrorBanner,
  Loading,
  Muted,
  Notice,
  Row,
  SectionTitle,
} from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { routeForUrl } from '@/lib/deep-link';
import { formatMoney } from '@/lib/format';
import { keys, useInvalidate, usePaymentConfig } from '@/lib/queries';
import { enumLabel } from '@/lib/status';

/** What is being paid: a PENDING_PAYMENT booking or the outstanding balance of an invoice (api.md §6.4 — exactly one target). */
export interface PayTarget {
  bookingId?: string;
  invoiceId?: string;
  label: string;
  amount: string;
  currency: string;
  dueLabel: string | null;
}

/**
 * The URL the hosted page returns to: `unigate://pay/return` in a development / store build, and
 * `exp://host/--/pay/return` inside Expo Go — the API allow-lists the app scheme everywhere and
 * the Expo Go scheme outside production (payment.service `assertReturnUrl`), so the auth session
 * closes on the real link in both cases. The mock-outcome buttons remain for a quick in-app check.
 */
export function paymentReturnUrl(): string {
  const scheme =
    typeof Constants.expoConfig?.scheme === 'string' ? Constants.expoConfig.scheme : 'unigate';
  return Linking.createURL('/pay/return', { scheme });
}

/**
 * Pay-now (api.md §8.17): `POST /payments { bookingId | invoiceId, amount, currency, methodType,
 * returnUrl, purpose }` with an Idempotency-Key, then follow `action.type`:
 *  - REDIRECT → the hosted page in an auth session that closes on the `unigate://pay/return` link,
 *  - NONE (bank transfer / cash) → the reference to quote; the booking confirms on reconciliation,
 *  - FORM_POST / SDK → not supported in this build (the gateway SDK lands later).
 * Success is never assumed from the return: the return screen polls `GET /payments/{id}/status`.
 */
export function PayScreen({ target }: { target: PayTarget }) {
  const { t, has, errorMessage } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const action = useAction(['methodType', 'amount', 'returnUrl']);
  const cfg = usePaymentConfig();
  const [method, setMethod] = useState('');
  const [pendingRef, setPendingRef] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<PaymentActionDto['type'] | null>(null);
  const [mock, setMock] = useState<PaymentDto | null>(null);

  const methodType = method || (cfg.data?.methodTypes[0] ?? '');
  const returnUrl = paymentReturnUrl();

  const goToReturn = (paymentId: string) => {
    router.replace({
      pathname: '/pay/return',
      params: {
        paymentId,
        ...(target.bookingId ? { bookingId: target.bookingId } : {}),
        ...(target.invoiceId ? { invoiceId: target.invoiceId } : {}),
      },
    });
  };

  const start = async () => {
    if (!methodType) return;
    setPendingRef(null);
    setUnsupported(null);
    setMock(null);
    const body = {
      ...(target.bookingId
        ? { bookingId: target.bookingId, purpose: 'BOOKING_PAYMENT' }
        : { invoiceId: target.invoiceId, purpose: 'INVOICE_PAYMENT' }),
      amount: target.amount,
      currency: target.currency,
      methodType,
      returnUrl,
    };
    const res = await action.run(() =>
      api<CreatePaymentResultDto>('/payments', {
        method: 'POST',
        body,
        headers: { 'Idempotency-Key': idempotencyKey() },
      }),
    );
    if (!res) return;
    const { action: next, payment } = res;
    await invalidate(keys.bookings, keys.invoices);

    if (next.type === 'REDIRECT' && next.url) {
      // The hosted page returns to `<returnUrl>?paymentId=…`; the state itself always comes from the API.
      const back = `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}paymentId=${encodeURIComponent(payment.id)}`;
      const url = withReturn(next.url, back);
      if (cfg.data?.isMock) setMock(payment);
      const result = await WebBrowser.openAuthSessionAsync(url, returnUrl);
      if (result.type === 'success') {
        const route = routeForUrl(result.url);
        goToReturn(
          route?.kind === 'payment'
            ? (new URL(result.url).searchParams.get('paymentId') ?? payment.id)
            : payment.id,
        );
        return;
      }
      // Dismissed: the customer may have paid anyway — the return screen will find out.
      if (!cfg.data?.isMock) goToReturn(payment.id);
      return;
    }
    if (next.type === 'NONE') {
      const ref = next.clientPayload?.['reference'];
      setPendingRef(typeof ref === 'string' ? ref : payment.paymentNumber);
      return;
    }
    setUnsupported(next.type);
  };

  return (
    <View className="py-4">
      <Card>
        <Row label={t('payments.for')} value={target.label} ltr />
        <Row
          label={t('payments.amount')}
          value={
            <Text
              className="text-lg font-bold text-card-foreground"
              style={{ writingDirection: 'ltr' }}
            >
              {formatMoney(target.amount, target.currency)}
            </Text>
          }
        />
        {target.dueLabel ? (
          <Row label={t('bookings.detail.paymentDue')} value={target.dueLabel} ltr />
        ) : null}
      </Card>

      <ErrorBanner message={action.banner} />
      {cfg.isPending ? (
        <Loading />
      ) : cfg.isError ? (
        <View>
          <ErrorBanner message={errorMessage(apiErrorOf(cfg.error))} />
          <Button
            title={t('common.retry')}
            variant="secondary"
            onPress={() => void cfg.refetch()}
          />
        </View>
      ) : pendingRef ? (
        <Notice tone="info" message={t('payments.bankTransfer', { reference: pendingRef })} />
      ) : unsupported ? (
        <Notice tone="warning" message={t('payments.unsupported', { type: unsupported })} />
      ) : (
        <View>
          <SelectField
            label={t('payments.method')}
            value={methodType}
            options={(cfg.data?.methodTypes ?? []).map((m) => ({
              value: m,
              label: enumLabel({ t, has }, 'paymentMethod', m),
            }))}
            onChange={setMethod}
            error={action.fields['methodType']}
          />
          <Button
            title={
              action.busy
                ? t('payments.redirecting')
                : t('payments.pay', { amount: formatMoney(target.amount, target.currency) })
            }
            loading={action.busy}
            disabled={!methodType}
            onPress={() => void start()}
          />
          <View className="mt-2">
            <Muted>{t('payments.securityNote')}</Muted>
          </View>
        </View>
      )}

      {mock && cfg.data?.isMock ? <MockOutcome payment={mock} onDone={goToReturn} /> : null}
    </View>
  );
}

/** Replace / add the `return` query parameter the gateway forwards to (the web does the same on its hosted-page URL). */
function withReturn(url: string, back: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set('return', back);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Development gateway only (`PaymentConfigDto.isMock`): the hosted page lives in the web portal
 * and needs a web session, which the phone's browser rarely has. Driving the outcome from here
 * calls the same dev-only `POST /payments/mock/checkout/{providerPaymentId}` the page calls, so
 * the signed webhook, the job and the booking transition all run for real; the app then polls.
 */
function MockOutcome({
  payment,
  onDone,
}: {
  payment: PaymentDto;
  onDone: (paymentId: string) => void;
}) {
  const { t } = useI18n();
  const action = useAction();
  const choose = async (outcome: 'SUCCESS' | 'DECLINE') => {
    if (!payment.providerPaymentId) return;
    const res = await action.run(() =>
      api(`/payments/mock/checkout/${encodeURIComponent(payment.providerPaymentId ?? '')}`, {
        method: 'POST',
        body: { outcome },
      }),
    );
    if (res !== null) onDone(payment.id);
  };
  return (
    <View className="mt-4">
      <SectionTitle>{t('payments.mock.title')}</SectionTitle>
      <Muted>{t('payments.mock.subtitle')}</Muted>
      <ErrorBanner message={action.banner} />
      <View className="mt-3 gap-3">
        <Button
          title={t('payments.mock.succeed')}
          loading={action.busy}
          onPress={() => void choose('SUCCESS')}
        />
        <Button
          title={t('payments.mock.decline')}
          variant="secondary"
          disabled={action.busy}
          onPress={() => void choose('DECLINE')}
        />
        <Button
          title={t('payments.mock.check')}
          variant="ghost"
          onPress={() => {
            onDone(payment.id);
          }}
        />
      </View>
    </View>
  );
}
