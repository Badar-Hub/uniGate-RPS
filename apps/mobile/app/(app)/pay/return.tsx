import { useEffect, useReducer, useState } from 'react';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { PaymentDto, PaymentStatusDto } from '@unigate/types';
import { Button, Loading, Muted, Screen, usePalette } from '@/components/ui';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { INITIAL_POLL_STATE, paymentOutcome, paymentPollReducer } from '@/lib/payment-poll';
import { keys } from '@/lib/queries';

/**
 * Checkout return (`unigate://pay/return?paymentId=…`, or the in-app hand-off after the mock
 * outcome): polls `GET /payments/{id}/status` with the bounded backoff in `payment-poll.ts`
 * until PAID / FAILED / CANCELLED, then shows the outcome and goes back to the booking or invoice.
 * The state is the API's — the return itself proves nothing (api.md §10).
 */
export default function PaymentReturnScreen() {
  const params = useLocalSearchParams<{ paymentId?: string; bookingId?: string; invoiceId?: string }>();
  const paymentId = typeof params.paymentId === 'string' ? params.paymentId : '';
  const { t, has, errorMessage } = useI18n();
  const router = useRouter();
  const qc = useQueryClient();
  const colors = usePalette();
  const [state, dispatch] = useReducer(paymentPollReducer, INITIAL_POLL_STATE);
  const [target, setTarget] = useState<{ bookingId: string | null; invoiceId: string | null }>({
    bookingId: typeof params.bookingId === 'string' ? params.bookingId : null,
    invoiceId: typeof params.invoiceId === 'string' ? params.invoiceId : null,
  });

  // A deep-link return carries only the payment id: read the payment once to learn where to go back to.
  useEffect(() => {
    if (!paymentId || target.bookingId || target.invoiceId) return;
    void api<PaymentDto>(`/payments/${paymentId}`).then((r) => {
      if (r.ok) setTarget({ bookingId: r.data.bookingId, invoiceId: r.data.invoiceId });
    });
  }, [paymentId, target.bookingId, target.invoiceId]);

  useEffect(() => {
    if (!paymentId) return;
    dispatch({ type: 'reset' });
  }, [paymentId]);

  useEffect(() => {
    if (!paymentId || state.phase !== 'polling' || state.nextDelayMs === null) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api<PaymentStatusDto>(`/payments/${paymentId}/status`).then((r) => {
        if (cancelled) return;
        if (r.ok) dispatch({ type: 'result', status: r.data });
        else dispatch({ type: 'failure', code: r.error.code });
      });
    }, state.nextDelayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [paymentId, state.phase, state.nextDelayMs, state.attempt]);

  // Once settled, the booking / invoice caches are stale.
  useEffect(() => {
    if (state.phase === 'settled') {
      void qc.invalidateQueries({ queryKey: keys.bookings });
      void qc.invalidateQueries({ queryKey: keys.invoices });
    }
  }, [state.phase, qc]);

  const outcome = paymentOutcome(state);
  const back = () => {
    if (target.bookingId) router.replace({ pathname: '/bookings/[id]', params: { id: target.bookingId, ...(outcome === 'paid' ? { paid: '1' } : {}) } });
    else if (target.invoiceId) router.replace(`/invoices/${target.invoiceId}`);
    else router.replace('/(app)/(tabs)/bookings');
  };

  if (!paymentId) {
    return (
      <Screen header>
        <View className="py-8">
          <Muted>{t('payments.returnMissing')}</Muted>
          <View className="mt-4">
            <Button title={t('common.back')} variant="secondary" onPress={back} />
          </View>
        </View>
      </Screen>
    );
  }

  const failureLabel = state.last?.failureCode ? (has(`errors.${state.last.failureCode}`) ? t(`errors.${state.last.failureCode}`) : state.last.failureCode) : (state.last?.status ?? '');

  return (
    <Screen header>
      <View className="flex-1 items-center justify-center px-4">
        {state.phase === 'polling' ? (
          <>
            <Loading />
            <Text className="text-center text-base text-foreground">{t('payments.confirming')}</Text>
          </>
        ) : outcome === 'paid' ? (
          <>
            <Ionicons name="checkmark-circle" size={64} color={colors.primary} />
            <Text className="mt-3 text-center text-xl font-bold text-foreground">{t('payments.confirmed')}</Text>
          </>
        ) : outcome === 'failed' ? (
          <>
            <Ionicons name="close-circle" size={64} color={colors.destructive} />
            <Text className="mt-3 text-center text-xl font-bold text-foreground">{t('payments.failedTitle')}</Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">{t('payments.failed', { code: failureLabel })}</Text>
          </>
        ) : outcome === 'error' ? (
          <>
            <Ionicons name="alert-circle" size={64} color={colors.destructive} />
            <Text className="mt-3 text-center text-sm text-muted-foreground">
              {errorMessage({ status: 0, code: state.errorCode ?? 'NETWORK', message: '' })}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="time-outline" size={64} color={colors.mutedForeground} />
            <Text className="mt-3 text-center text-xl font-bold text-foreground">{t('payments.pendingTitle')}</Text>
            <Text className="mt-1 text-center text-sm text-muted-foreground">{t('payments.stillPending')}</Text>
          </>
        )}
        <View className="mt-8 w-full gap-3">
          {state.phase !== 'polling' && outcome !== 'paid' ? (
            <Button title={t('payments.checkAgain')} variant="secondary" onPress={() => { dispatch({ type: 'reset' }); }} />
          ) : null}
          {state.phase !== 'polling' ? <Button title={target.bookingId ? t('payments.backToBooking') : t('common.back')} onPress={back} /> : null}
        </View>
      </View>
    </Screen>
  );
}
