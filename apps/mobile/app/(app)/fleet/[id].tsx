import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CalendarEntryDto, VehicleAssignmentDto, VehicleDto } from '@unigate/types';
import { DateTimeField } from '@/components/date-time-field';
import { DocumentChecklist } from '@/components/document-checklist';
import { SelectField } from '@/components/select-field';
import { Sheet } from '@/components/sheet';
import { Badge, Button, Card, CheckRow, ErrorBanner, Field, Label, Loading, Muted, Notice, QueryState, Row, Screen, SectionTitle, Segmented, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import { keys, useCities, useDrivers, useInvalidate, useVehicle, useVehicleCalendar, useVehicleDrivers } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { statusLabel, toneFor, VEHICLE_SUBMITTABLE_STATUSES } from '@/lib/status';

type Tab = 'documents' | 'calendar' | 'drivers';

/**
 * One vehicle (api.md §8.8): approval / lifecycle / dispatchability with the reasons, the spec
 * card, submit for approval (`POST /vehicles/{id}/submit-for-approval`), and the three panels
 * the web's VehicleDetail has — the document checklist with upload, the calendar with owner
 * blocks, and the driver assignments.
 */
export default function VehicleDetailScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const vehicleId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const { me, can } = useSession();
  const invalidate = useInvalidate();
  const q = useVehicle(vehicleId);
  const cities = useCities();
  const action = useAction();
  const [tab, setTab] = useState<Tab>('documents');
  const [acted, setActed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const v = q.data;
  const manages = Boolean(v && (can('vehicles.read_any') || me?.profiles.owner?.id === v.ownerProfileId));
  const createdNotice = v && created === '1' && !acted ? t('fleet.form.created') : null;
  const missing = (action.error?.details as { missing?: string[] } | undefined)?.missing;
  const refresh = () => invalidate(keys.vehicle(vehicleId), keys.vehicles);

  const submit = async () => {
    setActed(true);
    setNotice(null);
    const res = await action.run(() => api<VehicleDto>(`/vehicles/${vehicleId}/submit-for-approval`, { method: 'POST', body: {} }));
    if (!res) return;
    await refresh();
    setNotice(t('fleet.detail.submitted'));
  };

  const cityName = (cityId: string | null) => {
    const c = cities.data?.find((x) => x.id === cityId);
    return c ? (locale === 'ar' ? c.nameAr : c.nameEn) : null;
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {v ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{v.plateNumberEn}</Title>
                <Muted>
                  {[v.make?.name, v.model?.name, String(v.modelYear)].filter(Boolean).join(' · ')} · {locale === 'ar' ? v.category.nameAr : v.category.nameEn}
                </Muted>
              </View>
              <View className="items-end gap-1">
                <StatusBadge label={statusLabel({ t, has }, 'vehicleApproval', v.approvalStatus)} tone={toneFor('vehicleApproval', v.approvalStatus)} />
                <StatusBadge label={statusLabel({ t, has }, 'vehicleLifecycle', v.lifecycleStatus)} tone={toneFor('vehicleLifecycle', v.lifecycleStatus)} />
                <StatusBadge label={v.dispatchable.ok ? t('fleet.dispatchable') : t('fleet.notDispatchable')} tone={v.dispatchable.ok ? 'success' : 'warning'} />
              </View>
            </View>

            <View className="mt-4">
              <Notice message={notice ?? createdNotice} />
              <ErrorBanner message={action.banner ? `${action.banner}${missing?.length ? ` (${missing.join(', ')})` : ''}` : null} />
              {v.approvalStatus === 'REJECTED' && v.rejectionReason ? <ErrorBanner message={`${t('fleet.detail.rejectedReason')}: ${v.rejectionReason}`} /> : null}
            </View>

            {manages && !v.dispatchable.ok ? (
              <Card>
                <Text className="text-sm font-semibold text-card-foreground text-start">{t('fleet.detail.reasons')}</Text>
                <View className="mt-2 flex-row flex-wrap gap-2">
                  {v.dispatchable.reasons.map((r) => (
                    <Badge key={r}>{has(`fleet.reasons.${r}`) ? t(`fleet.reasons.${r}`) : r}</Badge>
                  ))}
                </View>
              </Card>
            ) : null}

            {manages && VEHICLE_SUBMITTABLE_STATUSES.includes(v.approvalStatus) && can('vehicles.update') ? (
              <View className="mb-3">
                <Button title={t('fleet.detail.submit')} loading={action.busy} onPress={() => void submit()} />
                <Muted>{t('fleet.detail.submitHint')}</Muted>
              </View>
            ) : null}

            <SectionTitle>{t('fleet.spec.title')}</SectionTitle>
            <Card>
              <Row label={t('fleet.spec.color')} value={v.colorCode} />
              <Row label={t('fleet.form.registrationNumber')} value={v.registrationNumber} ltr />
              {v.plateNumberAr ? <Row label={t('fleet.form.plateAr')} value={v.plateNumberAr} /> : null}
              {v.vin ? <Row label={t('fleet.form.vin')} value={v.vin} ltr /> : null}
              {v.passengerCapacity !== null ? <Row label={t('fleet.spec.passengerCapacity')} value={String(v.passengerCapacity)} ltr /> : null}
              {v.payloadCapacityKg ? <Row label={t('fleet.spec.payloadCapacityKg')} value={v.payloadCapacityKg} ltr /> : null}
              {v.cargoVolumeM3 ? <Row label={t('fleet.spec.cargoVolumeM3')} value={v.cargoVolumeM3} ltr /> : null}
              {v.bodyType ? <Row label={t('fleet.spec.bodyType')} value={v.bodyType} /> : null}
              {v.hasRefrigeration || v.hasTailLift ? (
                <Row label={t('fleet.spec.features')} value={[v.hasRefrigeration ? t('fleet.spec.refrigeration') : null, v.hasTailLift ? t('fleet.spec.tailLift') : null].filter(Boolean).join(' · ')} />
              ) : null}
              {cityName(v.baseCityId) ? <Row label={t('fleet.form.baseCity')} value={cityName(v.baseCityId) ?? ''} /> : null}
              {v.odometerKm !== null ? <Row label={t('fleet.form.odometer')} value={`${v.odometerKm} km`} ltr /> : null}
              <Row label={t('fleet.spec.operational')} value={statusLabel({ t, has }, 'vehicleOperational', v.operationalStatus)} />
              {v.ratingCount > 0 ? <Row label={t('fleet.spec.rating')} value={`${v.ratingAvg} (${v.ratingCount})`} ltr /> : null}
              {v.insuranceExpiryDate ? <Row label={t('fleet.form.insuranceExpiry')} value={formatDate(v.insuranceExpiryDate, locale)} ltr /> : null}
              {v.registrationExpiryDate ? <Row label={t('fleet.form.registrationExpiry')} value={formatDate(v.registrationExpiryDate, locale)} ltr /> : null}
              {v.inspectionExpiryDate ? <Row label={t('fleet.form.inspectionExpiry')} value={formatDate(v.inspectionExpiryDate, locale)} ltr /> : null}
              {v.currentDrivers.length ? <Row label={t('fleet.spec.drivers')} value={v.currentDrivers.map((d) => d.driverName).join(', ')} /> : null}
            </Card>

            {manages ? (
              <>
                <View className="mt-4">
                  <Segmented<Tab>
                    options={[
                      { value: 'documents', label: t('fleet.detail.documents') },
                      { value: 'calendar', label: t('fleet.detail.calendar') },
                      { value: 'drivers', label: t('fleet.detail.drivers') },
                    ]}
                    value={tab}
                    onChange={setTab}
                  />
                </View>
                {tab === 'documents' ? (
                  <DocumentChecklist
                    target={{ kind: 'VEHICLE', id: v.id, label: v.plateNumberEn, transportType: v.category.transportType as 'PASSENGER' | 'GOODS' }}
                    onChanged={() => void refresh()}
                  />
                ) : tab === 'calendar' ? (
                  <CalendarPanel vehicleId={v.id} canManage={can('vehicles.availability.manage')} />
                ) : (
                  <DriversPanel vehicle={v} canAssign={can('drivers.assign')} onChanged={() => void refresh()} />
                )}
              </>
            ) : null}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}

const WINDOWS: { value: string; days: number }[] = [
  { value: '7', days: 7 },
  { value: '30', days: 30 },
  { value: '90', days: 90 },
];

/** `GET /vehicles/{id}/calendar?from&to`; owner blocks via `POST …/calendar/blocks` and `DELETE …/blocks/{entryId}`. */
function CalendarPanel({ vehicleId, canManage }: { vehicleId: string; canManage: boolean }) {
  const { t, has, locale, errorMessage } = useI18n();
  const invalidate = useInvalidate();
  const [win, setWin] = useState('30');
  const [adding, setAdding] = useState(false);
  const action = useAction();
  const days = WINDOWS.find((w) => w.value === win)?.days ?? 30;
  // Stable window bounds per choice (hour precision) so the query key does not churn every render.
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const from = start.toISOString();
  const to = new Date(start.getTime() + days * 86_400_000).toISOString();
  const q = useVehicleCalendar(vehicleId, from, to);
  const refresh = () => invalidate(keys.vehicle(vehicleId), ['vehicles', vehicleId, 'calendar']);

  const release = (entry: CalendarEntryDto) => {
    Alert.alert(t('fleet.detail.release'), t('fleet.detail.releaseConfirm'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('fleet.detail.release'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const ok = await action.run(() => api(`/vehicles/${vehicleId}/calendar/blocks/${entry.id}`, { method: 'DELETE' }));
            if (ok === null) return;
            await refresh();
          })();
        },
      },
    ]);
  };

  return (
    <View>
      <SectionTitle>{t('fleet.detail.window')}</SectionTitle>
      <Segmented options={WINDOWS.map((w) => ({ value: w.value, label: t('fleet.detail.days', { count: w.days }) }))} value={win} onChange={setWin} />
      <ErrorBanner message={action.banner} />
      {canManage ? (
        <View className="mb-3">
          <Button
            title={t('fleet.detail.addBlock')}
            variant="secondary"
            onPress={() => {
              setAdding(true);
            }}
          />
        </View>
      ) : null}
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <ErrorBanner message={errorMessage(apiErrorOf(q.error))} />
      ) : q.data.length === 0 ? (
        <Muted>{t('fleet.detail.noEntries')}</Muted>
      ) : (
        q.data.map((e) => (
          <Card key={e.id}>
            <View className="flex-row items-center justify-between gap-2">
              <StatusBadge label={statusLabel({ t, has }, 'calendarEntry', e.entryType)} tone={toneFor('calendarEntry', e.entryType)} />
              {e.bookingNumber ? (
                <Text className="text-sm font-medium text-card-foreground" style={{ writingDirection: 'ltr' }}>
                  {e.bookingNumber}
                </Text>
              ) : null}
            </View>
            <Muted ltr>
              {formatDateTime(e.period.from, locale)} → {formatDateTime(e.period.to, locale)}
            </Muted>
            {e.notes ? <Muted>{e.notes}</Muted> : null}
            {canManage && e.entryType === 'OWNER_BLOCK' && e.status !== 'RELEASED' ? (
              <View className="mt-2">
                <Button title={t('fleet.detail.release')} variant="ghost" disabled={action.busy} onPress={() => { release(e); }} />
              </View>
            ) : null}
          </Card>
        ))
      )}
      {adding ? (
        <BlockSheet
          vehicleId={vehicleId}
          onClose={() => {
            setAdding(false);
          }}
          onAdded={() => void refresh()}
        />
      ) : null}
    </View>
  );
}

/** Owner blackout `POST /vehicles/{id}/calendar/blocks { from, to, notes? }` — a 409 lists the conflicting entries. */
function BlockSheet({ vehicleId, onClose, onAdded }: { vehicleId: string; onClose: () => void; onAdded: () => void }) {
  const { t, has, locale } = useI18n();
  const action = useAction(['from', 'to', 'notes']);
  const [from, setFrom] = useState<Date | null>(null);
  const [to, setTo] = useState<Date | null>(null);
  const [notes, setNotes] = useState('');
  const conflicts = (action.error?.details as { conflicts?: { entryType: string; period: { from: string; to: string } }[] } | undefined)?.conflicts;

  const submit = async () => {
    if (!from || !to) return;
    const res = await action.run(() =>
      api<CalendarEntryDto>(`/vehicles/${vehicleId}/calendar/blocks`, {
        method: 'POST',
        body: { from: from.toISOString(), to: to.toISOString(), ...(notes.trim() ? { notes: notes.trim() } : {}) },
      }),
    );
    if (!res) return;
    onAdded();
    onClose();
  };

  return (
    <Sheet title={t('fleet.detail.block')} onClose={onClose}>
      <Muted>{t('fleet.detail.blockHint')}</Muted>
      <View className="mt-3">
        <ErrorBanner message={action.banner} />
        {conflicts?.map((c, i) => (
          <Muted key={i} ltr>
            {statusLabel({ t, has }, 'calendarEntry', c.entryType)}: {formatDateTime(c.period.from, locale)} → {formatDateTime(c.period.to, locale)}
          </Muted>
        ))}
      </View>
      <DateTimeField label={t('fleet.detail.blockFrom')} value={from} onChange={setFrom} minimumDate={new Date()} error={action.fields['from']} doneLabel={t('common.done')} />
      <DateTimeField label={t('fleet.detail.blockTo')} value={to} onChange={setTo} minimumDate={from ?? new Date()} error={action.fields['to']} doneLabel={t('common.done')} />
      <Label>{t('fleet.detail.blockNotes')}</Label>
      <Field value={notes} onChangeText={setNotes} error={action.fields['notes']} />
      <Button title={t('fleet.detail.addBlock')} loading={action.busy} disabled={!from || !to || to <= from} onPress={() => void submit()} />
    </Sheet>
  );
}

/** Assignment history (`GET /vehicles/{id}/drivers`), assign (`POST`, approved drivers of the same owner) and unassign (`DELETE …/{assignmentId}`). */
function DriversPanel({ vehicle, canAssign, onChanged }: { vehicle: VehicleDto; canAssign: boolean; onChanged: () => void }) {
  const { t, locale, errorMessage } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const history = useVehicleDrivers(vehicle.id);
  const approved = useDrivers('APPROVED', canAssign);
  const action = useAction(['driverProfileId', 'isPrimary']);
  const [pick, setPick] = useState('');
  const [primary, setPrimary] = useState(true);

  const open = (history.data ?? []).filter((a) => !a.assignedTo);
  const assignable = (approved.data ?? []).filter((d) => d.ownerProfileId === vehicle.ownerProfileId && !open.some((a) => a.driverProfileId === d.id));
  const refresh = async () => {
    await invalidate(keys.vehicleDrivers(vehicle.id), keys.drivers);
    onChanged();
  };

  const assign = async () => {
    const res = await action.run(() => api<VehicleAssignmentDto>(`/vehicles/${vehicle.id}/drivers`, { method: 'POST', body: { driverProfileId: pick, isPrimary: primary } }));
    if (!res) return;
    setPick('');
    await refresh();
  };
  const unassign = (a: VehicleAssignmentDto) => {
    Alert.alert(t('fleet.detail.unassign'), t('fleet.detail.unassignConfirm', { name: a.driverName }), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('fleet.detail.unassign'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const ok = await action.run(() => api(`/vehicles/${vehicle.id}/drivers/${a.id}`, { method: 'DELETE' }));
            if (ok === null) return;
            await refresh();
          })();
        },
      },
    ]);
  };

  return (
    <View>
      <ErrorBanner message={action.banner} />
      {canAssign ? (
        <>
          <SectionTitle>{t('fleet.detail.assign')}</SectionTitle>
          {approved.isPending ? (
            <Loading />
          ) : assignable.length === 0 ? (
            <Card>
              <Muted>{t('fleet.detail.noDrivers')}</Muted>
              <View className="mt-3">
                <Button
                  title={t('fleet.detail.registerDriver')}
                  variant="secondary"
                  onPress={() => {
                    router.push('/drivers/new');
                  }}
                />
              </View>
            </Card>
          ) : (
            <Card>
              <SelectField
                label={t('drivers.driver')}
                value={pick}
                options={assignable.map((d) => ({ value: d.id, label: (locale === 'ar' ? d.fullNameAr : null) ?? d.fullNameEn, hint: d.phoneE164 ?? undefined }))}
                onChange={setPick}
                placeholder={t('common.choose')}
                error={action.fields['driverProfileId']}
              />
              <CheckRow label={t('fleet.detail.primary')} value={primary} onChange={setPrimary} />
              <Button title={t('fleet.detail.assign')} loading={action.busy} disabled={!pick} onPress={() => void assign()} />
            </Card>
          )}
        </>
      ) : null}

      <SectionTitle>{t('fleet.detail.assignmentHistory')}</SectionTitle>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorBanner message={errorMessage(apiErrorOf(history.error))} />
      ) : history.data.length === 0 ? (
        <Muted>{t('common.empty')}</Muted>
      ) : (
        history.data.map((a) => (
          <Card key={a.id}>
            <View className="flex-row items-center justify-between gap-2">
              <Text className="flex-1 text-base font-medium text-card-foreground text-start">{a.driverName}</Text>
              {a.isPrimary ? <Badge>{t('fleet.detail.primary')}</Badge> : null}
              {!a.assignedTo ? <StatusBadge label={t('fleet.detail.active')} tone="success" /> : null}
            </View>
            <Muted ltr>
              {formatDateTime(a.assignedFrom, locale)} → {a.assignedTo ? formatDateTime(a.assignedTo, locale) : '…'}
              {a.unassignedReason ? ` · ${a.unassignedReason}` : ''}
            </Muted>
            {canAssign && !a.assignedTo ? (
              <View className="mt-2">
                <Button title={t('fleet.detail.unassign')} variant="ghost" disabled={action.busy} onPress={() => { unassign(a); }} />
              </View>
            ) : null}
          </Card>
        ))
      )}
    </View>
  );
}
