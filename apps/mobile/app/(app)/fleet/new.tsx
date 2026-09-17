import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import type { VehicleDto } from '@unigate/types';
import { DateField } from '@/components/date-field';
import { SelectField } from '@/components/select-field';
import { Button, CheckRow, ErrorBanner, Field, FormScreen, Label, Muted, SectionTitle, Segmented, TextArea } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { keys, settingValue, stringList, useAllVehicleCategories, useCities, useInvalidate, usePublicSettings, useVehicleMakes, useVehicleModels } from '@/lib/queries';
import { buildVehicleBody, DEFAULT_VEHICLE_FORM, KNOWN_VEHICLE_FIELDS, validateVehicleForm, type TransportType, type VehicleFormState } from '@/lib/vehicle-body';

/**
 * Register a vehicle (`POST /vehicles` ⧗, api.md §8.8) mirroring the web's `vehicle-form.tsx`:
 * category by vertical, make → model (`/reference/vehicle-makes`, `/reference/vehicle-models?makeId=`),
 * year, plates, sequence number, VIN, colour, the capacity block of the category's vertical,
 * features, base city, odometer and the three expiry dates. The vehicle lands in DRAFT; the
 * document checklist on its page takes it to PENDING_APPROVAL.
 */
export default function NewVehicleScreen() {
  const { t, has, locale } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const action = useAction(KNOWN_VEHICLE_FIELDS);
  const [form, setForm] = useState<VehicleFormState>(DEFAULT_VEHICLE_FORM);
  const [vertical, setVertical] = useState<TransportType>('PASSENGER');
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const settings = usePublicSettings();
  const verticals = useMemo(() => {
    const v = stringList(settingValue(settings.data, 'platform.verticals_enabled'));
    return v.length ? v : ['PASSENGER'];
  }, [settings.data]);
  const categories = useAllVehicleCategories();
  const makes = useVehicleMakes();
  const models = useVehicleModels(form.vehicleMakeId);
  const cities = useCities();

  const set = <K extends keyof VehicleFormState>(k: K, v: VehicleFormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const fe = (key: string): string | undefined => {
    const c = clientErrors[key];
    return c ? t(c) : action.fields[key];
  };
  const label = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const categoryOptions = (categories.data ?? [])
    .filter((c) => c.isActive && c.transportType === vertical)
    .map((c) => ({ value: c.id, label: label(c), hint: c.maxPassengerCapacity ? t('requests.form.seats', { count: c.maxPassengerCapacity }) : c.maxPayloadKg ? t('requests.form.payload', { kg: c.maxPayloadKg }) : undefined }));
  const category = categories.data?.find((c) => c.id === form.vehicleCategoryId);
  const transportType = (category?.transportType as TransportType | undefined) ?? vertical;

  const submit = async () => {
    const errors = validateVehicleForm(form, transportType);
    setClientErrors(errors);
    action.clear();
    if (Object.keys(errors).length) return;
    const body = buildVehicleBody(form, transportType);
    const created = await action.run(() => api<VehicleDto>('/vehicles', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } }));
    if (!created) return;
    await invalidate(keys.vehicles);
    router.replace({ pathname: '/fleet/[id]', params: { id: created.id, created: '1' } });
  };

  return (
    <FormScreen>
      <ErrorBanner message={action.banner} />
      {categories.isError || cities.isError ? <ErrorBanner message={t('requests.form.referenceFailed')} /> : null}

      {verticals.includes('GOODS') ? (
        <>
          <Label>{t('fleet.form.vertical')}</Label>
          <Segmented<TransportType>
            options={[
              { value: 'PASSENGER', label: t('requests.form.vertical.PASSENGER') },
              { value: 'GOODS', label: t('requests.form.vertical.GOODS') },
            ]}
            value={vertical}
            onChange={(v) => {
              setVertical(v);
              set('vehicleCategoryId', '');
            }}
          />
        </>
      ) : null}
      <SelectField
        label={t('fleet.form.category')}
        value={form.vehicleCategoryId}
        options={categoryOptions}
        onChange={(v) => {
          set('vehicleCategoryId', v);
        }}
        placeholder={categories.isPending ? t('common.loading') : t('common.choose')}
        error={fe('vehicleCategoryId')}
      />

      <SectionTitle>{t('fleet.form.identity')}</SectionTitle>
      <SelectField
        label={t('fleet.form.make')}
        value={form.vehicleMakeId}
        options={(makes.data ?? []).filter((m) => m.isActive).map((m) => ({ value: m.id, label: m.name }))}
        onChange={(v) => {
          setForm((f) => ({ ...f, vehicleMakeId: v, vehicleModelId: '' }));
        }}
        placeholder={t('fleet.form.noMake')}
        clearable
        error={fe('vehicleMakeId')}
      />
      <SelectField
        label={t('fleet.form.model')}
        value={form.vehicleModelId}
        options={(models.data ?? []).filter((m) => m.isActive).map((m) => ({ value: m.id, label: m.name, hint: m.bodyType ?? undefined }))}
        onChange={(v) => {
          set('vehicleModelId', v);
        }}
        placeholder={form.vehicleMakeId ? (models.isPending ? t('common.loading') : t('fleet.form.noMake')) : t('fleet.form.pickMakeFirst')}
        disabled={!form.vehicleMakeId || (models.data?.length ?? 0) === 0}
        clearable
        error={fe('vehicleModelId')}
      />
      <Label>{t('fleet.form.modelYear')}</Label>
      <Field value={form.modelYear} onChangeText={(v) => { set('modelYear', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" error={fe('modelYear')} />
      <Label>{t('fleet.form.plateEn')}</Label>
      <Field value={form.plateNumberEn} onChangeText={(v) => { set('plateNumberEn', v.toUpperCase()); }} autoCapitalize="characters" placeholder="1234 ABC" error={fe('plateNumberEn')} style={{ writingDirection: 'ltr' }} />
      <Label>{t('fleet.form.plateAr')}</Label>
      <Field value={form.plateNumberAr} onChangeText={(v) => { set('plateNumberAr', v); }} error={fe('plateNumberAr')} />
      <Label>{t('fleet.form.sequenceNumber')}</Label>
      <Field value={form.sequenceNumber} onChangeText={(v) => { set('sequenceNumber', v); }} error={fe('sequenceNumber')} style={{ writingDirection: 'ltr' }} />
      <Label>{t('fleet.form.registrationNumber')}</Label>
      <Field value={form.registrationNumber} onChangeText={(v) => { set('registrationNumber', v); }} error={fe('registrationNumber')} style={{ writingDirection: 'ltr' }} />
      <Label>{t('fleet.form.vin')}</Label>
      <Field value={form.vin} onChangeText={(v) => { set('vin', v.toUpperCase()); }} autoCapitalize="characters" maxLength={17} error={fe('vin')} style={{ writingDirection: 'ltr' }} />
      <Label>{t('fleet.form.colour')}</Label>
      <Field value={form.colorCode} onChangeText={(v) => { set('colorCode', v); }} error={fe('colorCode')} />

      <SectionTitle>{t('fleet.form.capacity')}</SectionTitle>
      {transportType === 'GOODS' ? (
        <>
          <Label>{t('fleet.form.payloadKg')}</Label>
          <Field value={form.payloadCapacityKg} onChangeText={(v) => { set('payloadCapacityKg', v); }} keyboardType="decimal-pad" error={fe('payloadCapacityKg')} />
          <Label>{t('fleet.form.volumeM3')}</Label>
          <Field value={form.cargoVolumeM3} onChangeText={(v) => { set('cargoVolumeM3', v); }} keyboardType="decimal-pad" error={fe('cargoVolumeM3')} />
          <Label>{t('fleet.form.bodyType')}</Label>
          <Field value={form.bodyType} onChangeText={(v) => { set('bodyType', v); }} error={fe('bodyType')} />
          <CheckRow label={t('fleet.spec.refrigeration')} value={form.hasRefrigeration} onChange={(v) => { set('hasRefrigeration', v); }} />
          <CheckRow label={t('fleet.spec.tailLift')} value={form.hasTailLift} onChange={(v) => { set('hasTailLift', v); }} />
        </>
      ) : (
        <>
          <Label>{t('fleet.form.passengerCapacity')}</Label>
          <Field value={form.passengerCapacity} onChangeText={(v) => { set('passengerCapacity', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" error={fe('passengerCapacity')} />
        </>
      )}

      <SectionTitle>{t('fleet.form.operations')}</SectionTitle>
      <SelectField
        label={t('fleet.form.baseCity')}
        value={form.baseCityId}
        options={(cities.data ?? []).map((c) => ({ value: c.id, label: label(c) }))}
        onChange={(v) => { set('baseCityId', v); }}
        placeholder={cities.isPending ? t('common.loading') : t('fleet.form.noMake')}
        clearable
        error={fe('baseCityId')}
      />
      <Label>{t('fleet.form.odometer')}</Label>
      <Field value={form.odometerKm} onChangeText={(v) => { set('odometerKm', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" error={fe('odometerKm')} />
      <DateField label={t('fleet.form.insuranceExpiry')} value={form.insuranceExpiryDate} onChange={(v) => { set('insuranceExpiryDate', v); }} clearable error={fe('insuranceExpiryDate')} />
      <DateField label={t('fleet.form.registrationExpiry')} value={form.registrationExpiryDate} onChange={(v) => { set('registrationExpiryDate', v); }} clearable error={fe('registrationExpiryDate')} />
      <DateField label={t('fleet.form.inspectionExpiry')} value={form.inspectionExpiryDate} onChange={(v) => { set('inspectionExpiryDate', v); }} clearable error={fe('inspectionExpiryDate')} />
      <Label>{t('fleet.form.notes')}</Label>
      <TextArea value={form.notes} onChangeText={(v) => { set('notes', v); }} error={fe('notes')} />

      <Muted>{has('fleet.form.hint') ? t('fleet.form.hint') : ''}</Muted>
      <View className="mt-3">
        <Button title={t('fleet.form.submit')} loading={action.busy} disabled={!form.vehicleCategoryId} onPress={() => void submit()} />
      </View>
    </FormScreen>
  );
}
