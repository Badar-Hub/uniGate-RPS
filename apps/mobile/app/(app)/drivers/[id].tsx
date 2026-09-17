import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { DriverDto } from '@unigate/types';
import { DocumentChecklist } from '@/components/document-checklist';
import { Button, Card, ErrorBanner, Muted, Notice, QueryState, Row, Screen, SectionTitle, Segmented, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { keys, settingValue, stringList, useDriver, useInvalidate, usePublicSettings } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { enumLabel, statusLabel, toneFor } from '@/lib/status';

/**
 * One driver (api.md §8.6): approval + availability, licence (last 4 only), the verticals with
 * "add vertical" (`PATCH /drivers/{id} { transportTypes }` — the driver is then re-approved for
 * it once the TGA card is verified), the availability toggle (`POST /drivers/{id}/availability`)
 * and the document checklist with upload (kind DRIVER).
 */
export default function DriverDetailScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const driverId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const { can } = useSession();
  const invalidate = useInvalidate();
  const q = useDriver(driverId);
  const action = useAction(['transportTypes', 'availabilityStatus']);
  const settings = usePublicSettings();
  const [acted, setActed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const d = q.data;
  const enabled = stringList(settingValue(settings.data, 'platform.verticals_enabled'));
  const verticals = enabled.length ? enabled : ['PASSENGER'];
  const applied = d?.verticals.map((v) => v.transportType) ?? [];
  const name = d ? ((locale === 'ar' ? d.fullNameAr : null) ?? d.fullNameEn) : '';
  const createdNotice = d && created === '1' && !acted ? t('drivers.created', { name }) : null;
  const missing = (action.error?.details as { missing?: string[] } | undefined)?.missing;
  const refresh = () => invalidate(keys.driver(driverId), keys.drivers);

  const addVertical = async (transportType: string) => {
    setActed(true);
    setNotice(null);
    const res = await action.run(() => api<DriverDto>(`/drivers/${driverId}`, { method: 'PATCH', body: { transportTypes: [...applied, transportType] } }));
    if (!res) return;
    await refresh();
    setNotice(t('drivers.verticalAdded'));
  };

  const setAvailability = async (availabilityStatus: 'OFF_DUTY' | 'AVAILABLE') => {
    setActed(true);
    setNotice(null);
    const res = await action.run(() => api<DriverDto>(`/drivers/${driverId}/availability`, { method: 'POST', body: { availabilityStatus } }));
    if (!res) return;
    await refresh();
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {d ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title>{name}</Title>
                <Muted ltr>{d.phoneE164 ?? '—'}</Muted>
              </View>
              <View className="items-end gap-1">
                <StatusBadge label={statusLabel({ t, has }, 'onboarding', d.approvalStatus)} tone={toneFor('onboarding', d.approvalStatus)} />
                <StatusBadge label={statusLabel({ t, has }, 'driverAvailability', d.availabilityStatus)} tone={toneFor('driverAvailability', d.availabilityStatus)} />
              </View>
            </View>

            <View className="mt-4">
              <Notice message={notice ?? createdNotice} />
              <ErrorBanner message={action.banner ? `${action.banner}${missing?.length ? ` (${missing.join(', ')})` : ''}` : null} />
            </View>

            {can('drivers.update') && d.availabilityStatus !== 'ON_TRIP' ? (
              <Card>
                <Muted>{t('drivers.availabilityHint')}</Muted>
                <View className="mt-2">
                  <Segmented
                    options={[
                      { value: 'AVAILABLE', label: statusLabel({ t, has }, 'driverAvailability', 'AVAILABLE') },
                      { value: 'OFF_DUTY', label: statusLabel({ t, has }, 'driverAvailability', 'OFF_DUTY') },
                    ]}
                    value={d.availabilityStatus === 'AVAILABLE' ? 'AVAILABLE' : 'OFF_DUTY'}
                    onChange={(v) => {
                      if (v !== d.availabilityStatus) void setAvailability(v === 'AVAILABLE' ? 'AVAILABLE' : 'OFF_DUTY');
                    }}
                  />
                </View>
              </Card>
            ) : null}

            <SectionTitle>{t('drivers.licence')}</SectionTitle>
            <Card>
              <Row label={t('drivers.form.idType')} value={enumLabel({ t, has }, 'idType', d.idType)} />
              {d.nationalIdLast4 ? <Row label={t('drivers.form.nationalId')} value={`···· ${d.nationalIdLast4}`} ltr /> : null}
              <Row label={t('drivers.form.licenseNumber')} value={d.licenseNumberLast4 ? t('drivers.licenceEnding', { last4: d.licenseNumberLast4 }) : '—'} ltr />
              <Row label={t('drivers.form.licenseExpiryDate')} value={formatDate(d.licenseExpiryDate, locale)} ltr />
              <Row label={t('drivers.form.licenseCategories')} value={d.licenseCategories.map((c) => (has(`drivers.form.licenceCategories.${c}`) ? t(`drivers.form.licenceCategories.${c}`) : c)).join(', ')} />
              {d.dateOfBirth ? <Row label={t('drivers.form.dateOfBirth')} value={formatDate(d.dateOfBirth, locale)} ltr /> : null}
              {d.emergencyContactName ? <Row label={t('drivers.form.emergencyContactName')} value={`${d.emergencyContactName}${d.emergencyContactPhone ? ` · ${d.emergencyContactPhone}` : ''}`} /> : null}
              {d.ratingCount > 0 ? <Row label={t('fleet.spec.rating')} value={`${d.ratingAvg} (${d.ratingCount})`} ltr /> : null}
            </Card>

            <SectionTitle>{t('drivers.verticals')}</SectionTitle>
            <Card>
              {d.verticals.map((v) => (
                <Row key={v.transportType} label={t(`requests.form.vertical.${v.transportType}`)} value={<StatusBadge label={statusLabel({ t, has }, 'vertical', v.status)} tone={toneFor('vertical', v.status)} />} />
              ))}
              {can('drivers.update')
                ? verticals
                    .filter((v) => !applied.includes(v))
                    .map((v) => (
                      <View key={v} className="mt-2">
                        <Button title={t('drivers.addVertical', { vertical: t(`requests.form.vertical.${v}`) })} variant="secondary" loading={action.busy} onPress={() => void addVertical(v)} />
                      </View>
                    ))
                : null}
            </Card>

            <DocumentChecklist
              target={{
                kind: 'DRIVER',
                id: d.id,
                label: name,
                ...(applied.length === 1 ? { transportType: applied[0] as 'PASSENGER' | 'GOODS' } : {}),
              }}
              onChanged={() => void refresh()}
            />
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
