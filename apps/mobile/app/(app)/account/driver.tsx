import { useEffect, useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import type { DriverDto } from '@unigate/types';
import { Button, Card, ErrorBanner, Loading, Muted, Notice, QueryState, Row, Screen, SectionTitle, Segmented, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useTracker } from '@/hooks/use-tracker';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { tracker } from '@/lib/driver/tracker';
import { formatDate, formatDateTime } from '@/lib/format';
import { keys, useDriver, useDriverAssignments, useInvalidate } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { statusLabel, toneFor } from '@/lib/status';

const LICENCE_WARN_DAYS = 30;

function licenceState(expiry: string | null): { days: number | null; tone: 'expired' | 'soon' | 'ok' | 'unknown' } {
  if (!expiry) return { days: null, tone: 'unknown' };
  const days = Math.ceil((new Date(`${expiry}T00:00:00`).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(days)) return { days: null, tone: 'unknown' };
  return { days, tone: days < 0 ? 'expired' : days <= LICENCE_WARN_DAYS ? 'soon' : 'ok' };
}

/**
 * The driver's own account (api.md §8.6, self scope): approval and availability with the
 * AVAILABLE ↔ OFF_DUTY toggle (`POST /drivers/{id}/availability`; ON_TRIP is system-set), the
 * licence expiry warning (the API refuses going on duty with an expired licence —
 * `DRIVER_LICENSE_EXPIRED`), the verticals, the vehicle assignments
 * (`GET /drivers/{id}/assignments`), the location permission state and sign-out (which
 * deregisters push and stops the location agent first).
 */
export default function DriverAccountScreen() {
  const { t, has, locale, errorMessage } = useI18n();
  const { me, signOut } = useSession();
  const invalidate = useInvalidate();
  const driverId = me?.profiles.driver?.id ?? '';
  const q = useDriver(driverId);
  const assignments = useDriverAssignments(driverId || null);
  const action = useAction(['availabilityStatus']);
  const s = useTracker();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void tracker().refreshPermission();
  }, []);

  const d = q.data;
  const licence = licenceState(d?.licenseExpiryDate ?? null);

  const setAvailability = async (availabilityStatus: 'OFF_DUTY' | 'AVAILABLE') => {
    setNotice(null);
    const res = await action.run(() => api<DriverDto>(`/drivers/${driverId}/availability`, { method: 'POST', body: { availabilityStatus } }));
    if (!res) return;
    await invalidate(keys.driver(driverId));
    setNotice(t('driver.account.availabilitySaved', { status: statusLabel({ t, has }, 'driverAvailability', res.availabilityStatus) }));
  };

  const confirmSignOut = () => {
    Alert.alert(t('common.signOut'), s.active ? t('driver.account.signOutWhileSharing') : t('account.signOutConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.signOut'), style: 'destructive', onPress: () => void signOut() },
    ]);
  };

  if (!me?.profiles.driver) {
    return (
      <Screen header>
        <View className="py-4">
          <Muted>{t('driver.noProfile')}</Muted>
        </View>
      </Screen>
    );
  }

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {d ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title>{(locale === 'ar' ? d.fullNameAr : null) ?? d.fullNameEn}</Title>
                <Muted ltr>{d.phoneE164 ?? '—'}</Muted>
              </View>
              <View className="items-end gap-1">
                <StatusBadge label={statusLabel({ t, has }, 'onboarding', d.approvalStatus)} tone={toneFor('onboarding', d.approvalStatus)} />
                <StatusBadge label={statusLabel({ t, has }, 'driverAvailability', d.availabilityStatus)} tone={toneFor('driverAvailability', d.availabilityStatus)} />
              </View>
            </View>

            <View className="mt-4">
              <Notice message={notice} />
              <ErrorBanner message={action.banner} />
              {licence.tone === 'expired' ? <Notice tone="warning" message={t('driver.account.licenceExpired', { date: formatDate(d.licenseExpiryDate, locale) })} /> : null}
              {licence.tone === 'soon' ? <Notice tone="warning" message={t('driver.account.licenceExpiring', { days: licence.days ?? 0, date: formatDate(d.licenseExpiryDate, locale) })} /> : null}
              {d.approvalStatus !== 'APPROVED' ? <Notice tone="info" message={t('driver.account.notApproved')} /> : null}
            </View>

            <SectionTitle>{t('driver.account.availability')}</SectionTitle>
            <Card>
              {d.availabilityStatus === 'ON_TRIP' ? (
                <Muted>{t('driver.account.onTrip')}</Muted>
              ) : (
                <>
                  <Muted>{t('driver.account.availabilityHint')}</Muted>
                  <View className="mt-2">
                    <Segmented
                      options={[
                        { value: 'AVAILABLE', label: statusLabel({ t, has }, 'driverAvailability', 'AVAILABLE') },
                        { value: 'OFF_DUTY', label: statusLabel({ t, has }, 'driverAvailability', 'OFF_DUTY') },
                      ]}
                      value={d.availabilityStatus === 'AVAILABLE' ? 'AVAILABLE' : 'OFF_DUTY'}
                      onChange={(v) => {
                        if (v !== d.availabilityStatus && !action.busy) void setAvailability(v === 'AVAILABLE' ? 'AVAILABLE' : 'OFF_DUTY');
                      }}
                    />
                  </View>
                </>
              )}
            </Card>

            <SectionTitle>{t('drivers.licence')}</SectionTitle>
            <Card>
              <Row label={t('drivers.form.licenseNumber')} value={d.licenseNumberLast4 ? t('drivers.licenceEnding', { last4: d.licenseNumberLast4 }) : '—'} ltr />
              <Row label={t('drivers.form.licenseExpiryDate')} value={formatDate(d.licenseExpiryDate, locale)} ltr />
              <Row label={t('drivers.form.licenseCategories')} value={d.licenseCategories.map((c) => (has(`drivers.form.licenceCategories.${c}`) ? t(`drivers.form.licenceCategories.${c}`) : c)).join(', ') || '—'} />
              {d.ratingCount > 0 ? <Row label={t('fleet.spec.rating')} value={`${d.ratingAvg} (${d.ratingCount})`} ltr /> : null}
            </Card>

            <SectionTitle>{t('drivers.verticals')}</SectionTitle>
            <Card>
              {d.verticals.length ? (
                d.verticals.map((v) => (
                  <Row key={v.transportType} label={has(`requests.form.vertical.${v.transportType}`) ? t(`requests.form.vertical.${v.transportType}`) : v.transportType} value={<StatusBadge label={statusLabel({ t, has }, 'vertical', v.status)} tone={toneFor('vertical', v.status)} />} />
                ))
              ) : (
                <Muted>{t('common.empty')}</Muted>
              )}
            </Card>

            <SectionTitle>{t('driver.account.assignments')}</SectionTitle>
            <Card>
              {assignments.isPending ? (
                <Loading />
              ) : assignments.isError ? (
                <ErrorBanner message={errorMessage(apiErrorOf(assignments.error))} />
              ) : assignments.data?.length ? (
                assignments.data.map((a, i) => (
                  <View key={a.id} className={`py-2 ${i > 0 ? 'border-t border-border' : ''}`}>
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="flex-1 text-sm font-medium text-card-foreground" style={{ writingDirection: 'ltr', textAlign: 'left' }} numberOfLines={1}>
                        {t('driver.account.vehicleRef', { id: a.vehicleId.slice(0, 8) })}
                      </Text>
                      <StatusBadge label={a.unassignedAt ? t('driver.account.assignmentEnded') : t('driver.account.assignmentActive')} tone={a.unassignedAt ? 'neutral' : 'success'} />
                    </View>
                    <Muted ltr>
                      {formatDateTime(a.assignedAt, locale)}
                      {a.unassignedAt ? ` → ${formatDateTime(a.unassignedAt, locale)}` : ''}
                    </Muted>
                  </View>
                ))
              ) : (
                <Muted>{t('driver.account.noAssignments')}</Muted>
              )}
            </Card>

            <SectionTitle>{t('driver.account.location')}</SectionTitle>
            <Card>
              <Row label={t('driver.account.permission')} value={t(`driver.account.permissionState.${s.permission}`)} />
              <Row label={t('driver.location.sharing')} value={s.active ? t('common.yes') : t('common.no')} />
              {s.queued > 0 ? <Row label={t('driver.account.queued')} value={String(s.queued)} ltr /> : null}
              <Muted>{t('driver.account.permissionHint')}</Muted>
              <View className="mt-2">
                <Button title={t('driver.location.openSettings')} variant="secondary" onPress={() => void Linking.openSettings()} />
              </View>
            </Card>

            <View className="mt-4">
              <Button title={t('common.signOut')} variant="destructive" onPress={confirmSignOut} />
            </View>
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
