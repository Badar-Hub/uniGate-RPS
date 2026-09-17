import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import type { ExpenseDto, ExpenseSummaryDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { Card, IconButton, Muted, Row } from '@/components/ui';
import { useI18n } from '@/i18n';
import { fetchOrThrow } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import { keys, useExpenseCategories } from '@/lib/queries';

/**
 * The owner's expenses (`GET /expenses`, api.md §8.22) with the by-category totals
 * (`GET /expenses/summary?groupBy=category`) on top, + → record, tap → detail (receipt).
 */
export default function ExpensesScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const categories = useExpenseCategories();
  const categoryName = (code: string) => {
    const c = categories.data?.find((x) => x.code === code);
    return c ? (locale === 'ar' ? c.nameAr : c.nameEn) : code;
  };
  return (
    <ListScreen<ExpenseDto>
      header
      title={t('expenses.title')}
      queryKey={keys.expenses}
      path="/expenses"
      above={<SummaryCard />}
      action={
        <IconButton
          icon="add-circle"
          label={t('expenses.record')}
          onPress={() => {
            router.push('/expenses/new');
          }}
        />
      }
      onPress={(e) => {
        router.push(`/expenses/${e.id}`);
      }}
      toRow={(e) => ({
        id: e.id,
        title: categoryName(e.categoryCode),
        subtitle: [e.vehiclePlate, e.vendorName, e.description].filter(Boolean).join(' · ') || undefined,
        status: e.isLocked ? t('expenses.locked') : e.receiptDocumentId ? t('expenses.receiptAttached') : t('expenses.noReceipt'),
        tone: e.isLocked ? 'neutral' : e.receiptDocumentId ? 'success' : 'warning',
        date: e.expenseDate,
        dateOnly: true,
        trailing: formatMoney(e.totalAmount, e.currency),
      })}
    />
  );
}

function SummaryCard() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: [...keys.expenses, 'summary', 'category'] as const,
    queryFn: () => fetchOrThrow<ExpenseSummaryDto>('/expenses/summary', { query: { groupBy: 'category' } }),
  });
  const s = q.data;
  if (!s || s.totals.count === 0) return null;
  return (
    <Card>
      <Muted>{t('expenses.summary')}</Muted>
      {s.rows.map((r) => (
        <Row key={r.key} label={r.label ?? r.key} value={formatMoney(r.totalAmount, s.currency)} ltr />
      ))}
      <Row label={t('expenses.total')} value={formatMoney(s.totals.totalAmount, s.currency)} ltr />
    </Card>
  );
}
