import { useState } from 'react';
import { Text, View } from 'react-native';
import type { TripDto, TripProofDto } from '@unigate/types';
import { UploadDocumentSheet } from '@/components/document-checklist';
import { Sheet } from '@/components/sheet';
import { Button, Card, Chip, ErrorBanner, Field, Label, Loading, Muted, Notice, SectionTitle } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { tracker } from '@/lib/driver/tracker';
import { isTerminal } from '@/lib/driver/transitions';
import { formatDateTime } from '@/lib/format';
import { keys, useInvalidate, useTripProofs } from '@/lib/queries';
import { enumLabel } from '@/lib/status';

const PROOF_TYPES = ['PICKUP_CONFIRMATION', 'DELIVERY_CONFIRMATION', 'DAMAGE_REPORT', 'EXCEPTION'] as const;
type ProofType = (typeof PROOF_TYPES)[number];

/**
 * Proofs on a trip (api.md §8.15): `GET /trips/{id}/proofs` listed newest first, **Record a
 * proof** → `POST /trips/{id}/proofs { proofType, recipientName?, recipientIdLast4?, notes?,
 * latitude?, longitude? }` with the device position, then the photo / signature through the
 * documents flow of §14.2 against the proof itself — `POST /documents/upload-url` with
 * `target { kind: TRIP_PROOF, id: <proofId> }` and the `POD_PHOTO` / `POD_SIGNATURE` types the
 * reference catalogue lists for TRIP_PROOF (the API links the document to the proof through
 * `documents.trip_proof_id`; the proof row must exist first, so a proof is always recorded
 * before its attachments).
 */
export function TripProofs({ trip }: { trip: TripDto }) {
  const { t, has, locale, errorMessage } = useI18n();
  const proofs = useTripProofs(trip.id);
  const invalidate = useInvalidate();
  const [adding, setAdding] = useState(false);
  const [attach, setAttach] = useState<{ proof: TripProofDto; type: 'POD_PHOTO' | 'POD_SIGNATURE' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => invalidate(keys.tripProofs(trip.id));

  return (
    <View>
      <View className="flex-row items-center justify-between">
        <SectionTitle>{t('driver.proofs.title')}</SectionTitle>
        {!isTerminal(trip.status) ? (
          <View className="mt-2">
            <Button title={t('driver.proofs.add')} variant="secondary" onPress={() => { setNotice(null); setAdding(true); }} />
          </View>
        ) : null}
      </View>
      <Notice message={notice} />
      <Card>
        {proofs.isPending ? (
          <Loading />
        ) : proofs.isError ? (
          <ErrorBanner message={errorMessage(apiErrorOf(proofs.error))} />
        ) : proofs.data?.length ? (
          [...proofs.data]
            .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))
            .map((p, i) => (
              <View key={p.id} className={`py-2 ${i > 0 ? 'border-t border-border' : ''}`}>
                <View className="flex-row items-center justify-between gap-2">
                  <Text className="flex-1 text-sm font-medium text-card-foreground text-start">{enumLabel({ t, has }, 'tripProofType', p.proofType)}</Text>
                  <Text className="text-xs text-muted-foreground" style={{ writingDirection: 'ltr' }}>{formatDateTime(p.capturedAt, locale)}</Text>
                </View>
                {p.recipientName ? <Muted>{t('driver.proofs.receivedBy', { name: p.recipientName, last4: p.recipientIdLast4 ? ` · ···· ${p.recipientIdLast4}` : '' })}</Muted> : null}
                {p.notes ? <Muted>{p.notes}</Muted> : null}
                {p.latitude !== null && p.longitude !== null ? (
                  <Muted ltr>
                    {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                  </Muted>
                ) : null}
                {p.signatureDocumentId ? <Muted>{t('driver.proofs.signatureAttached')}</Muted> : null}
                {!isTerminal(trip.status) ? (
                  <View className="mt-2 flex-row gap-2">
                    <View className="flex-1">
                      <Button title={t('driver.proofs.attachPhoto')} variant="secondary" onPress={() => { setAttach({ proof: p, type: 'POD_PHOTO' }); }} />
                    </View>
                    <View className="flex-1">
                      <Button title={t('driver.proofs.attachSignature')} variant="secondary" onPress={() => { setAttach({ proof: p, type: 'POD_SIGNATURE' }); }} />
                    </View>
                  </View>
                ) : null}
              </View>
            ))
        ) : (
          <Muted>{t('driver.proofs.empty')}</Muted>
        )}
      </Card>

      {adding ? (
        <AddProofSheet
          trip={trip}
          onClose={(created) => {
            setAdding(false);
            if (created) {
              void refresh();
              setNotice(t('driver.proofs.recorded'));
            }
          }}
        />
      ) : null}
      {attach ? (
        <UploadDocumentSheet
          target={{ kind: 'TRIP_PROOF', id: attach.proof.id, label: enumLabel({ t, has }, 'tripProofType', attach.proof.proofType) }}
          documentTypeCode={attach.type}
          name={attach.type === 'POD_PHOTO' ? t('driver.proofs.attachPhoto') : t('driver.proofs.attachSignature')}
          requiresExpiry={false}
          onClose={(doc) => {
            setAttach(null);
            if (doc) {
              void refresh();
              setNotice(t('driver.proofs.attached'));
            }
          }}
        />
      ) : null}
    </View>
  );
}

function AddProofSheet({ trip, onClose }: { trip: TripDto; onClose: (created: TripProofDto | null) => void }) {
  const { t, has } = useI18n();
  const action = useAction(['proofType', 'recipientName', 'recipientIdLast4', 'notes', 'latitude', 'longitude']);
  const [proofType, setProofType] = useState<ProofType>(trip.transportType === 'GOODS' ? 'DELIVERY_CONFIRMATION' : 'PICKUP_CONFIRMATION');
  const [recipientName, setRecipientName] = useState('');
  const [last4, setLast4] = useState('');
  const [notes, setNotes] = useState('');
  const [locating, setLocating] = useState(false);

  const submit = async () => {
    setLocating(true);
    const fix = await tracker().currentFix();
    setLocating(false);
    const created = await action.run(() =>
      api<TripProofDto>(`/trips/${trip.id}/proofs`, {
        method: 'POST',
        body: {
          proofType,
          ...(recipientName.trim() ? { recipientName: recipientName.trim() } : {}),
          ...(last4 ? { recipientIdLast4: last4 } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          ...(fix ? { latitude: fix.latitude, longitude: fix.longitude } : {}),
        },
      }),
    );
    if (created) onClose(created);
  };

  const needsRecipient = proofType === 'DELIVERY_CONFIRMATION';

  return (
    <Sheet title={t('driver.proofs.add')} onClose={() => { onClose(null); }}>
      <ErrorBanner message={action.banner} />
      <Label>{t('driver.proofs.type')}</Label>
      <View className="mb-2 flex-row flex-wrap">
        {PROOF_TYPES.map((p) => (
          <Chip key={p} label={enumLabel({ t, has }, 'tripProofType', p)} active={proofType === p} onPress={() => { setProofType(p); }} />
        ))}
      </View>
      <Label>{needsRecipient ? t('driver.proof.recipient') : t('driver.proofs.recipientOptional')}</Label>
      <Field value={recipientName} onChangeText={setRecipientName} error={action.fields['recipientName']} />
      <Label>{t('driver.proof.idLast4')}</Label>
      <Field value={last4} onChangeText={(v) => { setLast4(v.replace(/[^\d]/g, '').slice(0, 4)); }} keyboardType="number-pad" maxLength={4} style={{ writingDirection: 'ltr' }} error={action.fields['recipientIdLast4']} />
      <Label>{t('driver.proof.notes')}</Label>
      <Field value={notes} onChangeText={setNotes} error={action.fields['notes']} />
      <Muted>{t('driver.proofs.hint')}</Muted>
      <View className="mt-3">
        <Button
          title={locating ? t('driver.trip.locating') : t('driver.proofs.save')}
          loading={action.busy || locating}
          disabled={(needsRecipient && recipientName.trim().length < 2) || (last4.length > 0 && last4.length !== 4)}
          onPress={() => void submit()}
        />
      </View>
    </Sheet>
  );
}
