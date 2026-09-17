import { useState } from 'react';
import { useRouter } from 'expo-router';
import { INVOICE_STATUS, type InvoiceDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';
import { formatMoney } from '@/lib/format';
import { keys } from '@/lib/queries';
import { enumLabel, statusLabel, toneFor } from '@/lib/status';

/** The buyer's invoices (`GET /invoices`, api.md §8.19): number, type, due date, total, outstanding, status. */
export default function InvoicesScreen() {
  const { t, has } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');
  return (
    <ListScreen<InvoiceDto>
      header
      title={t('invoices.title')}
      queryKey={keys.invoices}
      path="/invoices"
      query={status ? { status } : {}}
      filters={[{ value: '', label: t('common.all') }, ...INVOICE_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'invoice', s) }))]}
      filter={status}
      onFilter={setStatus}
      onPress={(i) => {
        router.push(`/invoices/${i.id}`);
      }}
      toRow={(i) => ({
        id: i.id,
        title: i.invoiceNumber,
        subtitle: `${enumLabel({ t, has }, 'invoiceType', i.invoiceType)} · ${t('invoices.outstanding')}: ${formatMoney(i.outstandingAmount, i.currency)}`,
        status: statusLabel({ t, has }, 'invoice', i.status),
        tone: toneFor('invoice', i.status),
        date: i.dueDate,
        dateLabel: t('invoices.due'),
        dateOnly: true,
        trailing: formatMoney(i.totalAmount, i.currency),
      })}
    />
  );
}
