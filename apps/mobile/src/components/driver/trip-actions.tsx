import { useState } from 'react';
import { Text, View } from 'react-native';
import { idempotencyKey } from '@unigate/api-client';
import type { TripDto, TripProofDto, TripStatusResultDto } from '@unigate/types';
import { Button, Card, ErrorBanner, Field, Label, Muted, Notice } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { tracker } from '@/lib/driver/tracker';
import { buildStatusBody, canConfirm, driverActions, isTerminal, needsBayan, needsOdometer, needsProof, odometerFloor } from '@/lib/driver/transitions';
import { statusLabel } from '@/lib/status';

/**
 * The status buttons — exactly the API's `allowedNextStatuses` (minus CANCELLED) — and the
 * confirmation form for the chosen step: the odometer where the vertical requires it, the
 * proof-of-delivery fields before DELIVERED (goods), the Bayan reference before departure when
 * the goods trip has none, and a note. Mirrors the PWA's `driver-trip.tsx` `move()`:
 *   1. goods DELIVERED → `POST /trips/{id}/proofs { proofType: DELIVERY_CONFIRMATION, … }` first;
 *   2. goods departure without a reference → `PATCH /trips/{id} { regulatoryReference, regulatoryReferenceType: BAYAN }`;
 *   3. `POST /trips/{id}/status { status, occurredAt, latitude?, longitude?, accuracyM?, note?, odometerKm?, proofId? }`
 *      with an Idempotency-Key and the device's current position (the agent's last fix or a
 *      one-shot GPS read) — the API records it in `trip_status_history` (security.md T-30).
 */
export function TripActions({ trip, onUpdated }: { trip: TripDto; onUpdated: (result: TripStatusResultDto) => void }) {
  const { t, has } = useI18n();
  const action = useAction(['status', 'occurredAt', 'latitude', 'longitude', 'accuracyM', 'note', 'odometerKm', 'proofId', 'recipientName', 'recipientIdLast4', 'notes', 'regulatoryReference', 'regulatoryReferenceType']);
  const [pending, setPending] = useState<string | null>(null);
  const [odometer, setOdometer] = useState('');
  const [note, setNote] = useState('');
  const [bayan, setBayan] = useState('');
  const [proof, setProof] = useState({ recipientName: '', recipientIdLast4: '', notes: '' });
  const [notice, setNotice] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  if (isTerminal(trip.status)) {
    return <Muted>{trip.status === 'COMPLETED' ? t('driver.trip.done') : t('driver.trip.cancelled')}</Muted>;
  }

  const actions = driverActions(trip);
  const odometerNeeded = pending !== null && needsOdometer(trip, pending);
  const proofNeeded = pending !== null && needsProof(trip, pending);
  const bayanNeeded = pending !== null && needsBayan(trip, pending);
  const allowed = (action.error?.details as { allowed?: string[] } | undefined)?.allowed;

  const reset = () => {
    setPending(null);
    setOdometer('');
    setNote('');
    setBayan('');
    setProof({ recipientName: '', recipientIdLast4: '', notes: '' });
  };

  const move = async (status: string) => {
    setNotice(null);
    setLocating(true);
    const fix = await tracker().currentFix();
    setLocating(false);
    const result = await action.run(async () => {
      let proofId: string | undefined;
      if (proofNeeded) {
        const p = await api<TripProofDto>(`/trips/${trip.id}/proofs`, {
          method: 'POST',
          body: {
            proofType: 'DELIVERY_CONFIRMATION',
            recipientName: proof.recipientName.trim(),
            ...(proof.recipientIdLast4 ? { recipientIdLast4: proof.recipientIdLast4 } : {}),
            ...(proof.notes.trim() ? { notes: proof.notes.trim() } : {}),
            ...(fix ? { latitude: fix.latitude, longitude: fix.longitude } : {}),
          },
        });
        if (!p.ok) return p;
        proofId = p.data.id;
      }
      if (bayanNeeded && bayan.trim()) {
        const b = await api<TripDto>(`/trips/${trip.id}`, { method: 'PATCH', body: { regulatoryReference: bayan.trim(), regulatoryReferenceType: 'BAYAN' } });
        if (!b.ok) return b;
      }
      return api<TripStatusResultDto>(`/trips/${trip.id}/status`, {
        method: 'POST',
        body: buildStatusBody(trip, { status, occurredAt: new Date().toISOString(), fix, note, odometer, proofId }),
        headers: { 'Idempotency-Key': idempotencyKey() },
      });
    });
    if (!result) return;
    reset();
    setNotice(t('driver.trip.updated', { status: statusLabel({ t, has }, 'trip', result.status) }));
    onUpdated(result);
  };

  const actionLabel = (s: string) => (has(`driver.action.${s}`) ? t(`driver.action.${s}`) : statusLabel({ t, has }, 'trip', s));

  return (
    <View>
      <Notice message={notice} />
      <ErrorBanner message={action.banner ? `${action.banner}${allowed?.length ? ` (${allowed.map(actionLabel).join(' · ')})` : ''}` : null} />
      {pending ? (
        <Card>
          <Text className="mb-2 text-base font-semibold text-card-foreground text-start">{actionLabel(pending)}</Text>
          {odometerNeeded ? (
            <>
              <Label>{t('driver.trip.odometerPrompt')}</Label>
              <Field
                value={odometer}
                onChangeText={(v) => {
                  setOdometer(v.replace(/[^\d]/g, ''));
                }}
                keyboardType="number-pad"
                style={{ writingDirection: 'ltr' }}
                error={action.fields['odometerKm']}
              />
              <Muted>{t('driver.trip.odometerHint', { km: odometerFloor(trip, null) || '—' })}</Muted>
            </>
          ) : null}
          {proofNeeded ? (
            <View className="my-3 rounded-md border border-border p-3">
              <Text className="mb-2 text-sm font-medium text-card-foreground text-start">{t('driver.proof.title')}</Text>
              <Label>{t('driver.proof.recipient')}</Label>
              <Field value={proof.recipientName} onChangeText={(v) => { setProof({ ...proof, recipientName: v }); }} error={action.fields['recipientName']} />
              <Label>{t('driver.proof.idLast4')}</Label>
              <Field
                value={proof.recipientIdLast4}
                onChangeText={(v) => { setProof({ ...proof, recipientIdLast4: v.replace(/[^\d]/g, '').slice(0, 4) }); }}
                keyboardType="number-pad"
                maxLength={4}
                style={{ writingDirection: 'ltr' }}
                error={action.fields['recipientIdLast4']}
              />
              <Label>{t('driver.proof.notes')}</Label>
              <Field value={proof.notes} onChangeText={(v) => { setProof({ ...proof, notes: v }); }} error={action.fields['notes']} />
              <Muted>{t('driver.proof.hint')}</Muted>
            </View>
          ) : null}
          {bayanNeeded ? (
            <>
              <Label>{t('driver.trip.bayanPrompt')}</Label>
              <Field value={bayan} onChangeText={setBayan} autoCapitalize="characters" style={{ writingDirection: 'ltr' }} error={action.fields['regulatoryReference']} />
              <Muted>{t('driver.trip.bayanHint')}</Muted>
            </>
          ) : null}
          <View className="mt-2">
            <Label>{t('driver.trip.noteLabel')}</Label>
            <Field value={note} onChangeText={setNote} error={action.fields['note']} />
          </View>
          <Muted>{t('driver.trip.positionNote')}</Muted>
          <View className="mt-3 flex-row gap-2">
            <View className="flex-1">
              <Button
                title={locating ? t('driver.trip.locating') : t('driver.trip.confirm')}
                loading={action.busy || locating}
                disabled={!canConfirm(trip, { status: pending, odometer, proofRecipient: proof.recipientName })}
                onPress={() => void move(pending)}
              />
            </View>
            <View className="flex-1">
              <Button title={t('common.cancel')} variant="secondary" disabled={action.busy || locating} onPress={reset} />
            </View>
          </View>
        </Card>
      ) : (
        <View className="gap-2">
          {actions.length === 0 ? <Muted>{t('driver.trip.noActions')}</Muted> : null}
          {actions.map((s) => (
            <Button
              key={s}
              title={actionLabel(s)}
              variant={s === 'EXCEPTION' ? 'secondary' : 'primary'}
              onPress={() => {
                action.clear();
                setNotice(null);
                setPending(s);
              }}
            />
          ))}
        </View>
      )}
    </View>
  );
}
