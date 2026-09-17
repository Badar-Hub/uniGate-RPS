import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import type { BidDto } from '@unigate/types';
import { BidFormFields } from '@/components/bid-form';
import { Sheet } from '@/components/sheet';
import { Button, Card, ErrorBanner, Muted, Notice, QueryState, Row, Screen, SectionTitle, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { bidFormFromBid, buildBidPatch, KNOWN_BID_FIELDS, validateBidForm, type BidFormState } from '@/lib/bid-body';
import { formatDateTime, formatMoney } from '@/lib/format';
import { keys, useBid, useInvalidate } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { statusLabel, toneFor } from '@/lib/status';

/**
 * One bid (`GET /bids/{id}`, api.md §8.13): the server-computed amounts (base + extras + VAT =
 * total), vehicle / driver, validity, version, the effective commission when the settings expose
 * it, and — while SUBMITTED and the owner's own — revise (`PATCH /bids/{id}` ⧗, version bump)
 * and withdraw (`POST /bids/{id}/withdraw`).
 */
export default function BidDetailScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const bidId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const { me } = useSession();
  const router = useRouter();
  const invalidate = useInvalidate();
  const q = useBid(bidId);
  const action = useAction(['reason']);
  const [revising, setRevising] = useState(false);
  const [acted, setActed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const b = q.data;
  const own = Boolean(b && me?.profiles.owner?.id === b.ownerProfileId);
  const createdNotice = b && created === '1' && !acted ? t('bidForm.submitted', { number: b.bidNumber, total: formatMoney(b.totalAmount, b.currency) }) : null;
  const refresh = () => invalidate(keys.bid(bidId), keys.bids, keys.opportunities);

  const withdraw = () => {
    Alert.alert(t('myBids.withdraw'), t('myBids.withdrawConfirm'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('myBids.withdraw'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setActed(true);
            const res = await action.run(() => api<BidDto>(`/bids/${bidId}/withdraw`, { method: 'POST', body: {} }));
            if (!res) return;
            await refresh();
            setNotice(t('myBids.withdrawn'));
          })();
        },
      },
    ]);
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {b ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{b.bidNumber}</Title>
                <Muted ltr>
                  {b.requestNumber} · {t('myBids.version', { n: b.version })}
                </Muted>
              </View>
              <StatusBadge label={statusLabel({ t, has }, 'bid', b.status)} tone={toneFor('bid', b.status)} />
            </View>

            <View className="mt-4">
              <Notice message={notice ?? createdNotice} />
              <ErrorBanner message={action.banner} />
            </View>

            {b.status === 'ACCEPTED' && b.bookingId ? (
              <View className="mb-3">
                <Button
                  title={t('bids.booked')}
                  onPress={() => {
                    router.push(`/bookings/${b.bookingId ?? ''}`);
                  }}
                />
              </View>
            ) : null}
            {b.status === 'REJECTED' && b.rejectedReason ? <Notice tone="warning" message={t('myBids.rejectedReason', { reason: b.rejectedReason })} /> : null}

            <SectionTitle>{t('bookings.detail.amounts')}</SectionTitle>
            <Card>
              <Row label={t('bookings.detail.base')} value={formatMoney(b.baseAmount, b.currency)} ltr />
              {b.extrasBreakdown.map((x, i) => (
                <Row key={i} label={`· ${locale === 'ar' ? x.labelAr : x.labelEn}`} value={formatMoney(x.amount, b.currency)} ltr />
              ))}
              <Row label={t('bookings.detail.extras')} value={formatMoney(b.extrasAmount, b.currency)} ltr />
              <Row label={t('bookings.detail.vat', { rate: (Number(b.vatRate) * 100).toFixed(0) })} value={formatMoney(b.vatAmount, b.currency)} ltr />
              <Row
                label={t('bids.total')}
                value={
                  <Text className="text-base font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>
                    {formatMoney(b.totalAmount, b.currency)}
                  </Text>
                }
              />
              {b.effectiveCommission && b.effectiveCommission.type !== 'NONE' ? (
                <Row
                  label={t('myBids.commission')}
                  value={b.effectiveCommission.type === 'PERCENTAGE' ? `${b.effectiveCommission.value ?? ''}%` : formatMoney(b.effectiveCommission.value, b.currency)}
                  ltr
                />
              ) : null}
            </Card>

            <SectionTitle>{t('bookings.detail.vehicleSection')}</SectionTitle>
            <Card>
              <Row label={t('bookings.vehicle')} value={b.vehicle.description} />
              <Row label={t('bookings.detail.plate')} value={b.vehicle.plateNumberEn} ltr />
              <Row label={t('bookings.detail.driver')} value={b.driverName ?? t('bookings.detail.noDriver')} />
            </Card>

            <SectionTitle>{t('bidForm.timing')}</SectionTitle>
            <Card>
              <Row label={t('bids.validUntil')} value={formatDateTime(b.validUntil, locale)} ltr />
              {b.estimatedDurationMinutes !== null ? <Row label={t('bidForm.duration')} value={t('requests.detail.duration', { min: b.estimatedDurationMinutes })} ltr /> : null}
              <Row label={t('myBids.submittedAt')} value={formatDateTime(b.submittedAt, locale)} ltr />
              {b.lastRevisedAt ? <Row label={t('myBids.revisedAt')} value={formatDateTime(b.lastRevisedAt, locale)} ltr /> : null}
              {b.decidedAt ? <Row label={t('myBids.decidedAt')} value={formatDateTime(b.decidedAt, locale)} ltr /> : null}
              {b.ownerNotes ? <Row label={t('bidForm.notes')} value={b.ownerNotes} /> : null}
            </Card>

            <View className="mt-2 gap-3">
              <Button
                title={t('requests.detailTitle')}
                variant="secondary"
                onPress={() => {
                  router.push(`/requests/${b.tripRequestId}`);
                }}
              />
              {own && b.status === 'SUBMITTED' ? (
                <>
                  <Button
                    title={t('myBids.revise')}
                    onPress={() => {
                      setRevising(true);
                    }}
                  />
                  <Button title={t('myBids.withdraw')} variant="destructive" disabled={action.busy} onPress={withdraw} />
                </>
              ) : null}
            </View>

            {revising ? (
              <ReviseSheet
                bid={b}
                onClose={() => {
                  setRevising(false);
                }}
                onRevised={(updated) => {
                  setActed(true);
                  setNotice(t('myBids.revised', { n: updated.version, total: formatMoney(updated.totalAmount, updated.currency) }));
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

/** `PATCH /bids/{id}` ⧗ — only the changed fields, no totals; the API bumps `version` and recomputes. */
function ReviseSheet({ bid, onClose, onRevised }: { bid: BidDto; onClose: () => void; onRevised: (b: BidDto) => void }) {
  const { t } = useI18n();
  const action = useAction(KNOWN_BID_FIELDS);
  const [form, setForm] = useState<BidFormState>(() => bidFormFromBid(bid));
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const fields: Record<string, string | undefined> = { ...action.fields };
  for (const [k, v] of Object.entries(clientErrors)) fields[k] = t(v);

  const submit = async () => {
    const errors = validateBidForm(form);
    setClientErrors(errors);
    action.clear();
    if (Object.keys(errors).length) return;
    const patch = buildBidPatch(form, bid);
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    const updated = await action.run(() => api<BidDto>(`/bids/${bid.id}`, { method: 'PATCH', body: patch, headers: { 'Idempotency-Key': idempotencyKey() } }));
    if (!updated) return;
    onRevised(updated);
    onClose();
  };

  return (
    <Sheet title={t('myBids.reviseTitle', { number: bid.bidNumber })} onClose={onClose} ltrTitle>
      <Muted>{t('myBids.reviseHint')}</Muted>
      <View className="mt-3">
        <ErrorBanner message={action.banner} />
      </View>
      <BidFormFields
        form={form}
        onChange={setForm}
        vehicles={[{ value: bid.vehicle.id, label: bid.vehicle.plateNumberEn, hint: bid.vehicle.description }]}
        vehicleLocked
        fields={fields}
      />
      <View className="mt-4">
        <Button title={t('myBids.revise')} loading={action.busy} onPress={() => void submit()} />
      </View>
    </Sheet>
  );
}
