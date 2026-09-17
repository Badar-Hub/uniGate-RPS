import { ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { PayScreen } from '@/components/pay-screen';
import { Notice, QueryState, Screen } from '@/components/ui';
import { useI18n } from '@/i18n';
import { apiErrorOf } from '@/lib/api';
import { useInvoice } from '@/lib/queries';
import { PAYABLE_INVOICE_STATUSES } from '@/lib/status';

/** Pay the outstanding balance of an invoice (`POST /payments { invoiceId, purpose: 'INVOICE_PAYMENT' }`, api.md §8.17). */
export default function PayInvoiceScreen() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const id = typeof invoiceId === 'string' ? invoiceId : '';
  const { t, errorMessage } = useI18n();
  const q = useInvoice(id);
  const inv = q.data;
  const payable = Boolean(inv && PAYABLE_INVOICE_STATUSES.includes(inv.status) && Number(inv.outstandingAmount) > 0);

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {inv ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            {payable ? (
              <PayScreen target={{ invoiceId: inv.id, label: inv.invoiceNumber, amount: inv.outstandingAmount, currency: inv.currency, dueLabel: null }} />
            ) : (
              <Notice tone="info" message={t('payments.nothingToPay')} />
            )}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
