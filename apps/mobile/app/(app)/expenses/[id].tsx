import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { ExpenseDto } from '@unigate/types';
import { UploadDocumentSheet } from '@/components/document-checklist';
import { Button, Card, ErrorBanner, Muted, Notice, QueryState, Row, Screen, SectionTitle, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { keys, useExpenseCategories, useInvalidate } from '@/lib/queries';

/** Document type seeded for receipts (`appliesTo = EXPENSE`). */
const RECEIPT_TYPE = 'EXPENSE_RECEIPT';

/**
 * One expense (`GET /expenses/{id}`): amounts, date, vehicle, vendor; attach a receipt through
 * the documents flow (target `EXPENSE/{id}`, then `PATCH /expenses/{id} { receiptDocumentId }`);
 * delete while not locked (`DELETE /expenses/{id}`, 409 `EXPENSE_IMMUTABLE` once settled).
 */
export default function ExpenseDetailScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const expenseId = typeof id === 'string' ? id : '';
  const { t, locale, errorMessage } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const q = useQuery({
    queryKey: [...keys.expenses, expenseId] as const,
    queryFn: () => fetchOrThrow<ExpenseDto>(`/expenses/${expenseId}`),
    enabled: expenseId.length > 0,
  });
  const categories = useExpenseCategories();
  const action = useAction(['receiptDocumentId']);
  const [uploading, setUploading] = useState(false);
  const [acted, setActed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const e = q.data;
  const category = categories.data?.find((c) => c.code === e?.categoryCode);
  const createdNotice = e && created === '1' && !acted ? t('expenses.created') : null;
  const refresh = () => invalidate([...keys.expenses, expenseId], keys.expenses);

  const attach = async (documentId: string) => {
    setActed(true);
    const res = await action.run(() => api<ExpenseDto>(`/expenses/${expenseId}`, { method: 'PATCH', body: { receiptDocumentId: documentId } }));
    if (!res) return;
    await refresh();
    setNotice(t('expenses.receiptAttachedNotice'));
  };

  const remove = () => {
    Alert.alert(t('expenses.remove'), t('expenses.removeConfirm'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('expenses.remove'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setActed(true);
            const ok = await action.run(() => api(`/expenses/${expenseId}`, { method: 'DELETE' }));
            if (ok === null) return;
            await invalidate(keys.expenses);
            router.back();
          })();
        },
      },
    ]);
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {e ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title>{category ? (locale === 'ar' ? category.nameAr : category.nameEn) : e.categoryCode}</Title>
                <Muted ltr>{formatDate(e.expenseDate, locale)}</Muted>
              </View>
              <StatusBadge label={e.isLocked ? t('expenses.locked') : e.receiptDocumentId ? t('expenses.receiptAttached') : t('expenses.noReceipt')} tone={e.isLocked ? 'neutral' : e.receiptDocumentId ? 'success' : 'warning'} />
            </View>
            <View className="mt-4">
              <Notice message={notice ?? createdNotice} />
              <ErrorBanner message={action.banner} />
            </View>

            <SectionTitle>{t('bookings.detail.amounts')}</SectionTitle>
            <Card>
              <Row label={t('expenses.amount')} value={formatMoney(e.amount, e.currency)} ltr />
              <Row label={t('expenses.vat')} value={formatMoney(e.vatAmount, e.currency)} ltr />
              <Row label={t('expenses.total')} value={formatMoney(e.totalAmount, e.currency)} ltr />
              {e.vehiclePlate ? <Row label={t('expenses.vehicle')} value={e.vehiclePlate} ltr /> : null}
              {e.vendorName ? <Row label={t('expenses.vendor')} value={e.vendorName} /> : null}
              {e.description ? <Row label={t('expenses.description')} value={e.description} /> : null}
              {e.odometerKm !== null ? <Row label={t('fleet.form.odometer')} value={`${e.odometerKm} km`} ltr /> : null}
              <Row label={t('expenses.reimbursable')} value={e.isReimbursable ? t('common.yes') : t('common.no')} />
            </Card>

            {!e.isLocked ? (
              <View className="mt-2 gap-3">
                <Button
                  title={e.receiptDocumentId ? t('expenses.replaceReceipt') : t('expenses.attachReceipt')}
                  variant={e.receiptDocumentId ? 'secondary' : 'primary'}
                  onPress={() => {
                    setUploading(true);
                  }}
                />
                <Button title={t('expenses.remove')} variant="destructive" disabled={action.busy} onPress={remove} />
              </View>
            ) : (
              <Muted>{t('expenses.lockedHint')}</Muted>
            )}

            {uploading ? (
              <UploadDocumentSheet
                target={{ kind: 'EXPENSE', id: e.id, label: t('expenses.title') }}
                documentTypeCode={RECEIPT_TYPE}
                name={t('expenses.receipt')}
                requiresExpiry={false}
                onClose={(doc) => {
                  setUploading(false);
                  if (doc) void attach(doc.id);
                }}
              />
            ) : null}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
