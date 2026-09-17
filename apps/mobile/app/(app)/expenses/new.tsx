import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import type { ExpenseDto } from '@unigate/types';
import { DateField } from '@/components/date-field';
import { SelectField } from '@/components/select-field';
import { Button, CheckRow, ErrorBanner, Field, FormScreen, Label, Muted, TextArea } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { money } from '@/lib/bid-body';
import { isoDay } from '@/lib/format';
import { keys, useAllVehicles, useExpenseCategories, useInvalidate } from '@/lib/queries';

const FIELDS = ['expenseCategoryId', 'amount', 'vatAmount', 'expenseDate', 'vehicleId', 'vendorName', 'description', 'odometerKm', 'isReimbursable'];

/**
 * Record an expense (`POST /expenses` ⧗, api.md §8.22) with the web's body: category, net
 * amount + VAT as decimal strings, date, optional vehicle / vendor / description / odometer,
 * reimbursable flag. The receipt is attached on the expense page afterwards (the document
 * targets the expense id).
 */
export default function NewExpenseScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const action = useAction(FIELDS);
  const categories = useExpenseCategories();
  const vehicles = useAllVehicles();
  const [form, setForm] = useState({
    expenseCategoryId: '',
    amount: '',
    vatAmount: '',
    expenseDate: isoDay(new Date()),
    vehicleId: '',
    vendorName: '',
    description: '',
    odometerKm: '',
    isReimbursable: false,
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const categoryId = form.expenseCategoryId || (categories.data?.[0]?.id ?? '');
  const amount = money(form.amount);
  const vat = form.vatAmount.trim() ? money(form.vatAmount) : '0.00';
  const valid = Boolean(categoryId) && amount !== null && vat !== null && (Number(amount) > 0 || Number(vat) > 0) && form.expenseDate.length > 0;

  const submit = async () => {
    if (!valid || amount === null || vat === null) return;
    const body = {
      expenseCategoryId: categoryId,
      amount,
      vatAmount: vat,
      expenseDate: form.expenseDate,
      ...(form.vehicleId ? { vehicleId: form.vehicleId } : {}),
      ...(form.vendorName.trim() ? { vendorName: form.vendorName.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
      ...(form.odometerKm.trim() ? { odometerKm: Number(form.odometerKm) } : {}),
      isReimbursable: form.isReimbursable,
    };
    const created = await action.run(() => api<ExpenseDto>('/expenses', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } }));
    if (!created) return;
    await invalidate(keys.expenses);
    router.replace({ pathname: '/expenses/[id]', params: { id: created.id, created: '1' } });
  };

  return (
    <FormScreen>
      <ErrorBanner message={action.banner} />
      <Muted>{t('expenses.subtitle')}</Muted>
      <View className="mt-3">
        <SelectField
          label={t('expenses.category')}
          value={categoryId}
          options={(categories.data ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: locale === 'ar' ? c.nameAr : c.nameEn }))}
          onChange={(v) => { set('expenseCategoryId', v); }}
          placeholder={categories.isPending ? t('common.loading') : t('common.choose')}
          error={action.fields['expenseCategoryId']}
        />
        <Label>{t('expenses.amount')}</Label>
        <Field value={form.amount} onChangeText={(v) => { set('amount', v); }} keyboardType="decimal-pad" placeholder="0.00" error={action.fields['amount']} />
        <Label>{t('expenses.vat')}</Label>
        <Field value={form.vatAmount} onChangeText={(v) => { set('vatAmount', v); }} keyboardType="decimal-pad" placeholder="0.00" error={action.fields['vatAmount']} />
        <DateField label={t('expenses.date')} value={form.expenseDate} onChange={(v) => { set('expenseDate', v); }} maximumDate={new Date()} error={action.fields['expenseDate']} />
        <SelectField
          label={t('expenses.vehicle')}
          value={form.vehicleId}
          options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: v.plateNumberEn, hint: [v.make?.name, v.model?.name].filter(Boolean).join(' ') }))}
          onChange={(v) => { set('vehicleId', v); }}
          placeholder={t('fleet.form.noMake')}
          clearable
          error={action.fields['vehicleId']}
        />
        <Label>{t('expenses.vendor')}</Label>
        <Field value={form.vendorName} onChangeText={(v) => { set('vendorName', v); }} error={action.fields['vendorName']} />
        <Label>{t('expenses.description')}</Label>
        <TextArea value={form.description} onChangeText={(v) => { set('description', v); }} error={action.fields['description']} />
        <Label>{t('fleet.form.odometer')}</Label>
        <Field value={form.odometerKm} onChangeText={(v) => { set('odometerKm', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" error={action.fields['odometerKm']} />
        <CheckRow label={t('expenses.reimbursable')} value={form.isReimbursable} onChange={(v) => { set('isReimbursable', v); }} />
        <Button title={t('common.save')} loading={action.busy} disabled={!valid} onPress={() => void submit()} />
      </View>
    </FormScreen>
  );
}
