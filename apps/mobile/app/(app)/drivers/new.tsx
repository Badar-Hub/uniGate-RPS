import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import { ID_TYPE, type DriverDto } from '@unigate/types';
import { DateField } from '@/components/date-field';
import { SelectField } from '@/components/select-field';
import { Button, CheckRow, ErrorBanner, Field, FormScreen, Label, Muted, SectionTitle, Segmented } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { keys, settingValue, stringList, useInvalidate, usePublicSettings } from '@/lib/queries';
import { enumLabel } from '@/lib/status';

/** The licence classes the web form offers (portal `drivers.tsx` LICENCE_CATEGORIES). */
const LICENCE_CATEGORIES = ['PRIVATE', 'PUBLIC', 'HEAVY', 'BUS', 'MOTORCYCLE'] as const;

const FIELDS = ['fullNameEn', 'fullNameAr', 'phoneE164', 'preferredLocale', 'idType', 'nationalId', 'dateOfBirth', 'licenseNumber', 'licenseExpiryDate', 'licenseCategories', 'transportTypes', 'emergencyContactName', 'emergencyContactPhone'];

/**
 * Register a driver under the acting owner (`POST /drivers` ⧗, api.md §8.6) with the same body
 * the web's AddDriverDialog sends: names, phone (the driver signs in to the driver app with it
 * and a one-time code — no password here), locale, ID, licence, classes, the verticals applied
 * for and the emergency contact. The profile starts in DRAFT until its documents are verified.
 */
export default function NewDriverScreen() {
  const { t, has } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const action = useAction(FIELDS);
  const settings = usePublicSettings();
  const verticals = useMemo(() => {
    const v = stringList(settingValue(settings.data, 'platform.verticals_enabled'));
    return v.length ? v : ['PASSENGER'];
  }, [settings.data]);

  const [form, setForm] = useState({
    fullNameEn: '',
    fullNameAr: '',
    phoneE164: '',
    preferredLocale: 'ar',
    idType: 'NATIONAL_ID',
    nationalId: '',
    dateOfBirth: '',
    licenseNumber: '',
    licenseExpiryDate: '',
    licenseCategories: ['PRIVATE'] as string[],
    transportTypes: ['PASSENGER'] as string[],
    emergencyContactName: '',
    emergencyContactPhone: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const toggle = (k: 'licenseCategories' | 'transportTypes', v: string) => {
    setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  };

  const valid =
    form.fullNameEn.trim().length >= 2 &&
    /^\+[1-9]\d{7,14}$/.test(form.phoneE164.trim()) &&
    /^[12]\d{9}$/.test(form.nationalId.trim()) &&
    /^[0-9A-Z]{5,20}$/.test(form.licenseNumber.trim().toUpperCase()) &&
    form.licenseExpiryDate.length > 0 &&
    form.licenseCategories.length > 0 &&
    form.transportTypes.length > 0;

  const submit = async () => {
    const body = {
      fullNameEn: form.fullNameEn.trim(),
      ...(form.fullNameAr.trim() ? { fullNameAr: form.fullNameAr.trim() } : {}),
      phoneE164: form.phoneE164.trim(),
      preferredLocale: form.preferredLocale,
      idType: form.idType,
      nationalId: form.nationalId.trim(),
      ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
      licenseNumber: form.licenseNumber.trim().toUpperCase(),
      licenseExpiryDate: form.licenseExpiryDate,
      licenseCategories: form.licenseCategories,
      transportTypes: form.transportTypes,
      ...(form.emergencyContactName.trim() ? { emergencyContactName: form.emergencyContactName.trim() } : {}),
      ...(form.emergencyContactPhone.trim() ? { emergencyContactPhone: form.emergencyContactPhone.trim() } : {}),
    };
    const created = await action.run(() => api<DriverDto>('/drivers', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } }));
    if (!created) return;
    await invalidate(keys.drivers);
    router.replace({ pathname: '/drivers/[id]', params: { id: created.id, created: '1' } });
  };

  return (
    <FormScreen>
      <ErrorBanner message={action.banner} />
      <Muted>{t('drivers.form.loginHint')}</Muted>

      <SectionTitle>{t('drivers.form.identity')}</SectionTitle>
      <Label>{t('drivers.form.fullNameEn')}</Label>
      <Field value={form.fullNameEn} onChangeText={(v) => { set('fullNameEn', v); }} error={action.fields['fullNameEn']} />
      <Label>{t('drivers.form.fullNameAr')}</Label>
      <Field value={form.fullNameAr} onChangeText={(v) => { set('fullNameAr', v); }} error={action.fields['fullNameAr']} />
      <Label>{t('drivers.form.phone')}</Label>
      <Field value={form.phoneE164} onChangeText={(v) => { set('phoneE164', v); }} keyboardType="phone-pad" placeholder="+9665XXXXXXXX" error={action.fields['phoneE164']} style={{ writingDirection: 'ltr' }} />
      <Label>{t('drivers.form.locale')}</Label>
      <Segmented
        options={[
          { value: 'ar', label: t('common.arabic') },
          { value: 'en', label: t('common.english') },
        ]}
        value={form.preferredLocale}
        onChange={(v) => { set('preferredLocale', v); }}
      />
      <SelectField label={t('drivers.form.idType')} value={form.idType} options={ID_TYPE.map((x) => ({ value: x, label: enumLabel({ t, has }, 'idType', x) }))} onChange={(v) => { set('idType', v); }} error={action.fields['idType']} />
      <Label>{t('drivers.form.nationalId')}</Label>
      <Field value={form.nationalId} onChangeText={(v) => { set('nationalId', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" maxLength={10} error={action.fields['nationalId']} style={{ writingDirection: 'ltr' }} />
      <DateField label={t('drivers.form.dateOfBirth')} value={form.dateOfBirth} onChange={(v) => { set('dateOfBirth', v); }} maximumDate={new Date()} clearable error={action.fields['dateOfBirth']} />

      <SectionTitle>{t('drivers.licence')}</SectionTitle>
      <Label>{t('drivers.form.licenseNumber')}</Label>
      <Field value={form.licenseNumber} onChangeText={(v) => { set('licenseNumber', v.toUpperCase()); }} autoCapitalize="characters" error={action.fields['licenseNumber']} style={{ writingDirection: 'ltr' }} />
      <DateField label={t('drivers.form.licenseExpiryDate')} value={form.licenseExpiryDate} onChange={(v) => { set('licenseExpiryDate', v); }} minimumDate={new Date()} error={action.fields['licenseExpiryDate']} />
      <Label>{t('drivers.form.licenseCategories')}</Label>
      {LICENCE_CATEGORIES.map((c) => (
        <CheckRow key={c} label={t(`drivers.form.licenceCategories.${c}`)} value={form.licenseCategories.includes(c)} onChange={() => { toggle('licenseCategories', c); }} />
      ))}
      {action.fields['licenseCategories'] ? <Muted>{action.fields['licenseCategories']}</Muted> : null}

      <SectionTitle>{t('drivers.form.transportTypes')}</SectionTitle>
      {verticals.map((v) => (
        <CheckRow key={v} label={t(`requests.form.vertical.${v}`)} value={form.transportTypes.includes(v)} onChange={() => { toggle('transportTypes', v); }} />
      ))}
      {action.fields['transportTypes'] ? <Muted>{action.fields['transportTypes']}</Muted> : null}

      <SectionTitle>{t('drivers.form.emergency')}</SectionTitle>
      <Label>{t('drivers.form.emergencyContactName')}</Label>
      <Field value={form.emergencyContactName} onChangeText={(v) => { set('emergencyContactName', v); }} error={action.fields['emergencyContactName']} />
      <Label>{t('drivers.form.emergencyContactPhone')}</Label>
      <Field value={form.emergencyContactPhone} onChangeText={(v) => { set('emergencyContactPhone', v); }} keyboardType="phone-pad" placeholder="+9665XXXXXXXX" error={action.fields['emergencyContactPhone']} style={{ writingDirection: 'ltr' }} />

      <View className="mt-3">
        <Button title={t('drivers.form.submit')} loading={action.busy} disabled={!valid} onPress={() => void submit()} />
      </View>
    </FormScreen>
  );
}
