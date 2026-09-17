import { ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { PayScreen } from '@/components/pay-screen';
import { Notice, QueryState, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { apiErrorOf } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { useBooking } from '@/lib/queries';

/** Pay a PENDING_PAYMENT, PREPAID booking (api.md §8.17). Anything else shows why there is nothing to pay. */
export default function PayBookingScreen() {
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const id = typeof bookingId === 'string' ? bookingId : '';
  const { t, locale, errorMessage } = useI18n();
  const q = useBooking(id);
  const b = q.data;
  const payable = b?.status === 'PENDING_PAYMENT' && b.billingMode === 'PREPAID';

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {b ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            {payable ? (
              <PayScreen
                target={{
                  bookingId: b.id,
                  label: b.bookingNumber,
                  amount: b.totalAmount,
                  currency: b.currency,
                  dueLabel: b.paymentDueBy ? formatDateTime(b.paymentDueBy, locale) : null,
                }}
              />
            ) : (
              <Notice tone="info" message={b.billingMode === 'INVOICED' ? t('bookings.detail.invoicedNotice') : t('payments.nothingToPay')} />
            )}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
