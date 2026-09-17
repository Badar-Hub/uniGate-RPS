import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import type { MaintenanceRecordDto } from '@unigate/types';
import { Sheet } from '@/components/sheet';
import { Button, Card, CheckRow, ErrorBanner, Field, Label, Muted, Notice, QueryState, Row, Screen, SectionTitle, StatusBadge, TextArea, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { money } from '@/lib/bid-body';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { keys, useInvalidate, useMaintenanceRecord } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/**
 * One maintenance record (`GET /maintenance/records/{id}`): window, costs, workshop, parts; the
 * owner's transitions — start (`POST …/start`), complete (`POST …/complete` ⧗ with odometer,
 * final cost and the record-expense flag) and cancel (`POST …/cancel { reason }`).
 */
export default function MaintenanceDetailScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const recordId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const invalidate = useInvalidate();
  const q = useMaintenanceRecord(recordId);
  const action = useAction(['reason']);
  const [completing, setCompleting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [acted, setActed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const r = q.data;
  const createdNotice = r && created === '1' && !acted ? t('maintenance.created') : null;
  const refresh = () => invalidate(keys.maintenanceRecord(recordId), keys.maintenanceRecords, keys.vehicles, ['maintenance', 'due']);

  const start = async () => {
    setActed(true);
    const res = await action.run(() => api<MaintenanceRecordDto>(`/maintenance/records/${recordId}/start`, { method: 'POST', body: {} }));
    if (!res) return;
    await refresh();
    setNotice(t('maintenance.started'));
  };
  const cancel = async () => {
    setActed(true);
    const res = await action.run(() => api<MaintenanceRecordDto>(`/maintenance/records/${recordId}/cancel`, { method: 'POST', body: { reason: reason.trim() } }));
    if (!res) return;
    setCancelling(false);
    await refresh();
    setNotice(t('maintenance.cancelled'));
  };
  const confirmCancel = () => {
    Alert.alert(t('maintenance.cancel'), t('maintenance.cancelConfirm'), [
      { text: t('common.back'), style: 'cancel' },
      { text: t('maintenance.cancel'), style: 'destructive', onPress: () => void cancel() },
    ]);
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {r ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{r.vehiclePlate}</Title>
                <Muted>
                  {locale === 'ar' ? r.serviceTypeNameAr : r.serviceTypeNameEn} · {t(`maintenance.kinds.${r.maintenanceKind}`)}
                </Muted>
              </View>
              <StatusBadge label={statusLabel({ t, has }, 'maintenance', r.status)} tone={toneFor('maintenance', r.status)} />
            </View>
            <View className="mt-4">
              <Notice message={notice ?? createdNotice} />
              <ErrorBanner message={action.banner} />
            </View>

            <SectionTitle>{t('maintenance.window')}</SectionTitle>
            <Card>
              <Row label={t('maintenance.from')} value={formatDateTime(r.scheduledStartAt, locale)} ltr />
              <Row label={t('maintenance.to')} value={formatDateTime(r.scheduledEndAt, locale)} ltr />
              {r.actualStartAt ? <Row label={t('maintenance.actualStart')} value={formatDateTime(r.actualStartAt, locale)} ltr /> : null}
              {r.actualEndAt ? <Row label={t('maintenance.actualEnd')} value={formatDateTime(r.actualEndAt, locale)} ltr /> : null}
              {r.workshopName ? <Row label={t('maintenance.workshop')} value={`${r.workshopName}${r.workshopContact ? ` · ${r.workshopContact}` : ''}`} /> : null}
              {r.odometerKm !== null ? <Row label={t('fleet.form.odometer')} value={`${r.odometerKm} km`} ltr /> : null}
              {r.description ? <Row label={t('maintenance.description')} value={r.description} /> : null}
            </Card>

            <SectionTitle>{t('maintenance.cost')}</SectionTitle>
            <Card>
              <Row label={t('maintenance.cost')} value={formatMoney(r.costAmount, r.currency)} ltr />
              <Row label={t('maintenance.vat')} value={formatMoney(r.vatAmount, r.currency)} ltr />
              <Row label={t('maintenance.total')} value={formatMoney(r.totalAmount, r.currency)} ltr />
              {r.partsReplaced.map((p, i) => (
                <Row key={i} label={`· ${p.name} × ${p.quantity}`} value={p.amount ? formatMoney(p.amount, r.currency) : '—'} ltr />
              ))}
              {r.nextServiceDate ? <Row label={t('maintenance.nextService')} value={formatDate(r.nextServiceDate, locale)} ltr /> : null}
              {r.nextServiceOdometerKm !== null ? <Row label={t('maintenance.nextServiceKm')} value={`${r.nextServiceOdometerKm} km`} ltr /> : null}
            </Card>

            {r.status === 'PLANNED' || r.status === 'IN_PROGRESS' ? (
              <View className="mt-2 gap-3">
                {r.status === 'PLANNED' ? <Button title={t('maintenance.start')} loading={action.busy} onPress={() => void start()} /> : null}
                <Button
                  title={t('maintenance.complete.confirm')}
                  variant={r.status === 'IN_PROGRESS' ? 'primary' : 'secondary'}
                  disabled={action.busy}
                  onPress={() => {
                    setCompleting(true);
                  }}
                />
                {!cancelling ? (
                  <Button
                    title={t('maintenance.cancel')}
                    variant="ghost"
                    disabled={action.busy}
                    onPress={() => {
                      setCancelling(true);
                    }}
                  />
                ) : (
                  <View>
                    <Label>{t('maintenance.cancelReason')}</Label>
                    <Field value={reason} onChangeText={setReason} error={action.fields['reason']} />
                    <Button title={t('maintenance.cancel')} variant="destructive" loading={action.busy} disabled={reason.trim().length < 3} onPress={confirmCancel} />
                  </View>
                )}
              </View>
            ) : null}

            {completing ? (
              <CompleteSheet
                record={r}
                onClose={() => {
                  setCompleting(false);
                }}
                onCompleted={() => {
                  setActed(true);
                  setNotice(t('maintenance.completed'));
                  void refresh();
                }}
              />
            ) : null}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}

/** `POST /maintenance/records/{id}/complete` ⧗ — the web's completion dialog: odometer, final cost / VAT, notes, record the expense. */
function CompleteSheet({ record, onClose, onCompleted }: { record: MaintenanceRecordDto; onClose: () => void; onCompleted: () => void }) {
  const { t, locale } = useI18n();
  const action = useAction(['odometerKm', 'costAmount', 'vatAmount', 'notes', 'recordExpense']);
  const [form, setForm] = useState({ odometerKm: '', costAmount: record.costAmount === '0.00' ? '' : record.costAmount, vatAmount: record.vatAmount === '0.00' ? '' : record.vatAmount, notes: '', recordExpense: true });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const cost = form.costAmount.trim() ? money(form.costAmount) : undefined;
  const vat = form.vatAmount.trim() ? money(form.vatAmount) : undefined;
  const valid = cost !== null && vat !== null;

  const submit = async () => {
    if (!valid) return;
    const body = {
      ...(form.odometerKm.trim() ? { odometerKm: Number(form.odometerKm) } : {}),
      ...(cost ? { costAmount: cost } : {}),
      ...(vat ? { vatAmount: vat } : {}),
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      recordExpense: form.recordExpense,
    };
    const res = await action.run(() => api<MaintenanceRecordDto>(`/maintenance/records/${record.id}/complete`, { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } }));
    if (!res) return;
    onCompleted();
    onClose();
  };

  return (
    <Sheet title={t('maintenance.complete.title', { plate: record.vehiclePlate, type: locale === 'ar' ? record.serviceTypeNameAr : record.serviceTypeNameEn })} onClose={onClose}>
      <ErrorBanner message={action.banner} />
      <Label>{t('maintenance.complete.odometer')}</Label>
      <Field value={form.odometerKm} onChangeText={(v) => { set('odometerKm', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" error={action.fields['odometerKm']} />
      <Label>{t('maintenance.cost')}</Label>
      <Field value={form.costAmount} onChangeText={(v) => { set('costAmount', v); }} keyboardType="decimal-pad" placeholder="0.00" error={action.fields['costAmount']} />
      <Label>{t('maintenance.vat')}</Label>
      <Field value={form.vatAmount} onChangeText={(v) => { set('vatAmount', v); }} keyboardType="decimal-pad" placeholder="0.00" error={action.fields['vatAmount']} />
      <Label>{t('maintenance.complete.notes')}</Label>
      <TextArea value={form.notes} onChangeText={(v) => { set('notes', v); }} error={action.fields['notes']} />
      <CheckRow label={t('maintenance.complete.recordExpense')} value={form.recordExpense} onChange={(v) => { set('recordExpense', v); }} />
      <Button title={t('maintenance.complete.confirm')} loading={action.busy} disabled={!valid} onPress={() => void submit()} />
    </Sheet>
  );
}
