import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import { MAINTENANCE_KIND, type MaintenanceRecordDto } from '@unigate/types';
import { DateTimeField } from '@/components/date-time-field';
import { SelectField } from '@/components/select-field';
import { Button, ErrorBanner, Field, FormScreen, Label, Muted, Segmented, TextArea } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { money } from '@/lib/bid-body';
import { formatDateTime } from '@/lib/format';
import { keys, useAllVehicles, useInvalidate, useMaintenanceTypes } from '@/lib/queries';

const FIELDS = ['vehicleId', 'maintenanceServiceTypeId', 'maintenanceKind', 'status', 'scheduledStartAt', 'scheduledEndAt', 'costAmount', 'vatAmount', 'workshopName', 'description'];

/**
 * Plan a workshop visit (`POST /maintenance/records` ⧗, api.md §8.23) with the web's body. A
 * PLANNED or IN_PROGRESS record holds the vehicle on its calendar in the same transaction; a
 * 409 `MAINTENANCE_CALENDAR_CONFLICT` names the blocking booking.
 */
export default function NewMaintenanceScreen() {
  const { vehicleId: presetVehicle } = useLocalSearchParams<{ vehicleId?: string }>();
  const { t, has, locale } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const action = useAction(FIELDS);
  const vehicles = useAllVehicles();
  const types = useMaintenanceTypes();
  const [form, setForm] = useState({
    vehicleId: typeof presetVehicle === 'string' ? presetVehicle : '',
    maintenanceServiceTypeId: '',
    maintenanceKind: 'SCHEDULED',
    status: 'PLANNED',
    scheduledStartAt: null as Date | null,
    scheduledEndAt: null as Date | null,
    costAmount: '',
    vatAmount: '',
    workshopName: '',
    description: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const vehicleId = form.vehicleId || (vehicles.data?.[0]?.id ?? '');
  const typeId = form.maintenanceServiceTypeId || (types.data?.[0]?.id ?? '');
  const conflicts = (action.error?.details as { conflicts?: { entryType: string; period: { from: string; to: string }; bookingNumber?: string }[] } | undefined)?.conflicts;
  const valid = Boolean(vehicleId && typeId && form.scheduledStartAt && form.scheduledEndAt && form.scheduledEndAt > form.scheduledStartAt);

  const submit = async () => {
    if (!valid || !form.scheduledStartAt || !form.scheduledEndAt) return;
    const body = {
      vehicleId,
      maintenanceServiceTypeId: typeId,
      maintenanceKind: form.maintenanceKind,
      status: form.status,
      scheduledStartAt: form.scheduledStartAt.toISOString(),
      scheduledEndAt: form.scheduledEndAt.toISOString(),
      costAmount: money(form.costAmount) ?? '0.00',
      vatAmount: money(form.vatAmount) ?? '0.00',
      ...(form.workshopName.trim() ? { workshopName: form.workshopName.trim() } : {}),
      ...(form.description.trim() ? { description: form.description.trim() } : {}),
    };
    const created = await action.run(() => api<MaintenanceRecordDto>('/maintenance/records', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } }));
    if (!created) return;
    await invalidate(keys.maintenanceRecords, keys.vehicles);
    router.replace({ pathname: '/maintenance/[id]', params: { id: created.id, created: '1' } });
  };

  return (
    <FormScreen>
      <ErrorBanner message={action.banner} />
      {conflicts?.map((c, i) => (
        <Muted key={i} ltr>
          {c.bookingNumber ?? c.entryType}: {formatDateTime(c.period.from, locale)} → {formatDateTime(c.period.to, locale)}
        </Muted>
      ))}
      <Muted>{t('maintenance.holdHint')}</Muted>
      <View className="mt-3">
        <SelectField
          label={t('maintenance.vehicle')}
          value={vehicleId}
          options={(vehicles.data ?? []).map((v) => ({ value: v.id, label: v.plateNumberEn, hint: [v.make?.name, v.model?.name].filter(Boolean).join(' ') }))}
          onChange={(v) => { set('vehicleId', v); }}
          placeholder={vehicles.isPending ? t('common.loading') : t('common.choose')}
          error={action.fields['vehicleId']}
        />
        <SelectField
          label={t('maintenance.serviceType')}
          value={typeId}
          options={(types.data ?? []).filter((x) => x.isActive).map((x) => ({ value: x.id, label: locale === 'ar' ? x.nameAr : x.nameEn }))}
          onChange={(v) => { set('maintenanceServiceTypeId', v); }}
          placeholder={types.isPending ? t('common.loading') : t('common.choose')}
          error={action.fields['maintenanceServiceTypeId']}
        />
        <SelectField
          label={t('maintenance.kind')}
          value={form.maintenanceKind}
          options={MAINTENANCE_KIND.map((k) => ({ value: k, label: t(`maintenance.kinds.${k}`) }))}
          onChange={(v) => { set('maintenanceKind', v); }}
          error={action.fields['maintenanceKind']}
        />
        <Label>{t('maintenance.initialStatus')}</Label>
        <Segmented
          options={[
            { value: 'PLANNED', label: has('status.maintenance.PLANNED') ? t('status.maintenance.PLANNED') : 'PLANNED' },
            { value: 'IN_PROGRESS', label: has('status.maintenance.IN_PROGRESS') ? t('status.maintenance.IN_PROGRESS') : 'IN_PROGRESS' },
          ]}
          value={form.status}
          onChange={(v) => { set('status', v); }}
        />
        <DateTimeField label={t('maintenance.from')} value={form.scheduledStartAt} onChange={(d) => { set('scheduledStartAt', d); }} error={action.fields['scheduledStartAt']} doneLabel={t('common.done')} />
        <DateTimeField label={t('maintenance.to')} value={form.scheduledEndAt} onChange={(d) => { set('scheduledEndAt', d); }} minimumDate={form.scheduledStartAt ?? undefined} error={action.fields['scheduledEndAt']} doneLabel={t('common.done')} />
        <Label>{t('maintenance.cost')}</Label>
        <Field value={form.costAmount} onChangeText={(v) => { set('costAmount', v); }} keyboardType="decimal-pad" placeholder="0.00" error={action.fields['costAmount']} />
        <Label>{t('maintenance.vat')}</Label>
        <Field value={form.vatAmount} onChangeText={(v) => { set('vatAmount', v); }} keyboardType="decimal-pad" placeholder="0.00" error={action.fields['vatAmount']} />
        <Label>{t('maintenance.workshop')}</Label>
        <Field value={form.workshopName} onChangeText={(v) => { set('workshopName', v); }} error={action.fields['workshopName']} />
        <Label>{t('maintenance.description')}</Label>
        <TextArea value={form.description} onChangeText={(v) => { set('description', v); }} error={action.fields['description']} />
        <Button title={t('common.save')} loading={action.busy} disabled={!valid} onPress={() => void submit()} />
      </View>
    </FormScreen>
  );
}
