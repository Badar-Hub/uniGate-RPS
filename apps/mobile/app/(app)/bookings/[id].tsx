import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import type {
  BookingDisputeResultDto,
  BookingDto,
  BookingStatusHistoryDto,
  CancelBookingResultDto,
  CancellationQuoteDto,
} from '@unigate/types';
import { useEligibleDrivers } from '@/components/bid-form';
import { SelectField } from '@/components/select-field';
import { RatingPrompt } from '@/components/rating-prompt';
import { Sheet } from '@/components/sheet';
import {
  Badge,
  Button,
  Card,
  ErrorBanner,
  Field,
  Label,
  Loading,
  Muted,
  Notice,
  QueryState,
  Row,
  Screen,
  SectionTitle,
  StatusBadge,
  TextArea,
  Title,
} from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { keys, settingValue, stringList, useBooking, useInvalidate, usePublicSettings } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { CANCELLABLE_BOOKING_STATUSES, enumLabel, statusLabel, toneFor, TRACKABLE_TRIP_STATUSES } from '@/lib/status';

/**
 * One booking (api.md §8.14): status timeline (`GET /bookings/{id}/status-history`), vehicle /
 * driver / plate, the snapshot amounts, the billing mode (PREPAID pays now, INVOICED is billed on
 * the monthly invoice), cancel with the quote first, pay now, live tracking, rating after
 * completion and a dispute (`POST /bookings/{id}/dispute`).
 */
export default function BookingDetailScreen() {
  const { id, paid } = useLocalSearchParams<{ id: string; paid?: string }>();
  const bookingId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const { me } = useSession();
  const router = useRouter();
  const invalidate = useInvalidate();
  const q = useBooking(bookingId);
  const history = useQuery({
    queryKey: keys.bookingHistory(bookingId),
    queryFn: () => fetchOrThrow<BookingStatusHistoryDto[]>(`/bookings/${bookingId}/status-history`),
    enabled: bookingId.length > 0,
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(() => (paid === '1' ? t('payments.confirmed') : null));

  const b = q.data;
  const isCustomer = Boolean(b && me?.profiles.customer?.id === b.customerProfileId);
  const isOwner = Boolean(b && me?.profiles.owner?.id === b.ownerProfileId);
  const refresh = () => invalidate(keys.booking(bookingId), keys.bookingHistory(bookingId), keys.bookings, keys.requests);

  return (
    <Screen header>
      <QueryState
        pending={q.isPending}
        error={q.isError ? errorMessage(apiErrorOf(q.error)) : null}
        retryLabel={t('common.retry')}
        onRetry={() => void q.refetch()}
      >
        {b ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{b.bookingNumber}</Title>
                <Muted ltr>
                  {b.requestNumber} · {t('bookings.wave', { n: b.fulfilmentSequence })}
                </Muted>
              </View>
              <View className="items-end gap-1">
                <StatusBadge label={statusLabel({ t, has }, 'booking', b.status)} tone={toneFor('booking', b.status)} />
                <StatusBadge label={statusLabel({ t, has }, 'bookingPayment', b.paymentStatus)} tone={toneFor('bookingPayment', b.paymentStatus)} />
              </View>
            </View>

            <View className="mt-4">
              <Notice message={notice} />
            </View>

            {isCustomer && b.status === 'PENDING_PAYMENT' && b.billingMode === 'PREPAID' ? (
              <Card>
                <Text className="text-base font-semibold text-card-foreground text-start">{t('bookings.detail.payPrompt')}</Text>
                {b.paymentDueBy ? <Muted ltr>{t('bookings.detail.paymentDue')}: {formatDateTime(b.paymentDueBy, locale)}</Muted> : null}
                <View className="mt-3">
                  <Button
                    title={t('payments.pay', { amount: formatMoney(b.totalAmount, b.currency) })}
                    onPress={() => {
                      router.push(`/pay/${b.id}`);
                    }}
                  />
                </View>
              </Card>
            ) : null}
            {b.billingMode === 'INVOICED' ? <Notice tone="info" message={t('bookings.detail.invoicedNotice')} /> : null}

            {isOwner && (b.status === 'CONFIRMED' || b.status === 'DRIVER_ASSIGNED') ? (
              <OwnerDispatchCard
                booking={b}
                onDone={(message) => {
                  setNotice(message);
                  void refresh();
                }}
              />
            ) : null}

            {b.trip && TRACKABLE_TRIP_STATUSES.includes(b.trip.status) ? (
              <View className="mb-3">
                <Button
                  title={t('bookings.detail.track')}
                  onPress={() => {
                    router.push(`/track/${b.trip?.id ?? ''}`);
                  }}
                />
              </View>
            ) : null}

            {b.status === 'COMPLETED' && isCustomer ? <RatingPrompt bookingId={b.id} /> : null}

            <SectionTitle>{t('bookings.detail.schedule')}</SectionTitle>
            <Card>
              <Row label={t('bookings.detail.start')} value={formatDateTime(b.scheduledStartAt, locale)} ltr />
              <Row label={t('bookings.detail.end')} value={formatDateTime(b.scheduledEndAt, locale)} ltr />
              <Row label={t('requests.pickup')} value={b.pickup.addressLine} />
              <Row label={t('requests.dropoff')} value={b.dropoff.addressLine} />
            </Card>

            <SectionTitle>{t('bookings.detail.vehicleSection')}</SectionTitle>
            <Card>
              <Row label={t('bookings.vehicle')} value={b.vehicleDescriptionSnapshot} />
              <Row label={t('bookings.detail.plate')} value={b.vehiclePlateSnapshot} ltr />
              <Row label={t('bookings.detail.owner')} value={b.ownerNameSnapshot} />
              <Row label={t('bookings.detail.driver')} value={b.driverName ?? t('bookings.detail.noDriver')} />
              {b.trip ? <Row label={t('bookings.detail.trip')} value={`${b.trip.tripNumber} · ${statusLabel({ t, has }, 'trip', b.trip.status)}`} ltr /> : null}
            </Card>

            <SectionTitle>{t('bookings.detail.amounts')}</SectionTitle>
            <Card>
              <Row label={t('bookings.detail.base')} value={formatMoney(b.agreedBaseAmount, b.currency)} ltr />
              <Row label={t('bookings.detail.extras')} value={formatMoney(b.agreedExtrasAmount, b.currency)} ltr />
              <Row label={t('bookings.detail.vat', { rate: (Number(b.vatRate) * 100).toFixed(0) })} value={formatMoney(b.vatAmount, b.currency)} ltr />
              <Row label={t('bookings.total')} value={<Text className="text-base font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>{formatMoney(b.totalAmount, b.currency)}</Text>} />
              <Row label={t('bookings.detail.billingMode')} value={enumLabel({ t, has }, 'billingMode', b.billingMode)} />
              {b.creditTermsDaysSnapshot !== null ? <Row label={t('bookings.detail.creditTerms')} value={t('bookings.detail.days', { count: b.creditTermsDaysSnapshot })} /> : null}
            </Card>

            {b.financial ? (
              <>
                <SectionTitle>{t('bookings.detail.financial')}</SectionTitle>
                <Card>
                  <Row label={t('bookings.detail.gross')} value={formatMoney(b.financial.grossAmount, b.currency)} ltr />
                  <Row label={t('bookings.detail.netOfVat')} value={formatMoney(b.financial.netOfVatAmount, b.currency)} ltr />
                  <Row label={t('bookings.detail.commission')} value={`− ${formatMoney(b.financial.commissionAmount, b.currency)}`} ltr />
                  <Row label={t('bookings.detail.commissionVat')} value={`− ${formatMoney(b.financial.commissionVatAmount, b.currency)}`} ltr />
                  {b.financial.paymentFeeAmount !== '0.00' ? <Row label={t('bookings.detail.paymentFee')} value={`− ${formatMoney(b.financial.paymentFeeAmount, b.currency)}`} ltr /> : null}
                  <Row label={t('bookings.detail.net')} value={<Text className="text-base font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>{formatMoney(b.financial.ownerNetAmount, b.currency)}</Text>} />
                  <Row label={t('bookings.detail.commissionSource')} value={enumLabel({ t, has }, 'commissionSource', b.financial.commissionSource)} />
                </Card>
              </>
            ) : null}

            {b.cancellation ? (
              <>
                <SectionTitle>{t('bookings.detail.cancellation')}</SectionTitle>
                <Card>
                  <Row label={t('bookings.detail.cancelledBy')} value={enumLabel({ t, has }, 'cancelledBy', b.cancellation.cancelledByRole)} />
                  <Row label={t('bookings.detail.reason')} value={enumLabel({ t, has }, 'cancellationReason', b.cancellation.reasonCode)} />
                  {b.cancellation.reasonText ? <Row label={t('bookings.detail.reasonText')} value={b.cancellation.reasonText} /> : null}
                  <Row label={t('bookings.detail.fee')} value={formatMoney(b.cancellation.cancellationFeeAmount, b.cancellation.currency)} ltr />
                  <Row label={t('bookings.detail.refund')} value={formatMoney(b.cancellation.refundAmount, b.cancellation.currency)} ltr />
                  {b.cancellation.feeWaivedAt ? <Badge>{t('bookings.detail.feeWaived')}</Badge> : null}
                </Card>
              </>
            ) : null}

            <SectionTitle>{t('bookings.detail.history')}</SectionTitle>
            <Card>
              {history.isPending ? (
                <Loading />
              ) : history.isError ? (
                <ErrorBanner message={errorMessage(apiErrorOf(history.error))} />
              ) : history.data?.length ? (
                history.data.map((h, i) => (
                  <View key={h.id} className={`flex-row items-start gap-3 py-2 ${i > 0 ? 'border-t border-border' : ''}`}>
                    <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between gap-2">
                        <StatusBadge label={statusLabel({ t, has }, 'booking', h.toStatus)} tone={toneFor('booking', h.toStatus)} />
                        <Text className="text-xs text-muted-foreground" style={{ writingDirection: 'ltr' }}>{formatDateTime(h.occurredAt, locale)}</Text>
                      </View>
                      {h.reason ? <Muted>{h.reason}</Muted> : null}
                    </View>
                  </View>
                ))
              ) : (
                <Muted>{t('common.empty')}</Muted>
              )}
            </Card>

            {isCustomer ? (
              <View className="mt-2 gap-3">
                {CANCELLABLE_BOOKING_STATUSES.includes(b.status) ? (
                  <Button title={t('bookings.detail.cancel')} variant="destructive" onPress={() => { setCancelOpen(true); }} />
                ) : null}
                {b.status === 'IN_PROGRESS' || b.status === 'COMPLETED' ? (
                  <Button title={t('bookings.detail.dispute')} variant="secondary" onPress={() => { setDisputeOpen(true); }} />
                ) : null}
              </View>
            ) : null}

            {cancelOpen ? (
              <CancelSheet
                booking={b}
                onClose={() => { setCancelOpen(false); }}
                onCancelled={(res) => {
                  setNotice(t('bookings.detail.cancelled', { fee: formatMoney(res.cancellation.cancellationFeeAmount), refund: formatMoney(res.cancellation.refundAmount) }));
                  void refresh();
                }}
              />
            ) : null}
            {disputeOpen ? (
              <DisputeSheet
                booking={b}
                onClose={() => { setDisputeOpen(false); }}
                onDisputed={(res) => {
                  setNotice(t('bookings.detail.disputed', { number: res.complaint.complaintNumber }));
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

/** The quote is fetched first so the customer sees exactly what the cancel will charge (api.md §8.14 `cancellation-quote`). */
function CancelSheet({ booking, onClose, onCancelled }: { booking: BookingDto; onClose: () => void; onCancelled: (r: CancelBookingResultDto) => void }) {
  const { t, has, errorMessage } = useI18n();
  const action = useAction(['reasonCode', 'reasonText']);
  const quote = useQuery({
    queryKey: keys.cancellationQuote(booking.id),
    queryFn: () => fetchOrThrow<CancellationQuoteDto>(`/bookings/${booking.id}/cancellation-quote`),
    staleTime: 0,
  });
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const codes = quote.data?.allowedReasonCodes ?? [];
  const reasonCode = reason || (codes[0] ?? '');

  const confirm = () => {
    Alert.alert(t('bookings.detail.confirmCancel'), t('bookings.detail.cancelFinal'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('bookings.detail.confirmCancel'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const res = await action.run(() =>
              api<CancelBookingResultDto>(`/bookings/${booking.id}/cancel`, {
                method: 'POST',
                body: { reasonCode, ...(text.trim() ? { reasonText: text.trim() } : {}) },
                headers: { 'Idempotency-Key': idempotencyKey() },
              }),
            );
            if (!res) return;
            onCancelled(res);
            onClose();
          })();
        },
      },
    ]);
  };

  return (
    <Sheet title={t('bookings.detail.cancelTitle', { number: booking.bookingNumber })} onClose={onClose} ltrTitle>
      {quote.isPending ? (
        <Loading />
      ) : quote.isError ? (
        <ErrorBanner message={errorMessage(apiErrorOf(quote.error))} />
      ) : quote.data ? (
        <View>
          <Muted>{t('bookings.detail.cancelDescription', { hours: quote.data.hoursBeforePickup })}</Muted>
          <Card>
            <Row label={t('bookings.detail.fee')} value={formatMoney(quote.data.feeAmount, quote.data.currency)} ltr />
            <Row label={t('bookings.detail.refund')} value={formatMoney(quote.data.refundAmount, quote.data.currency)} ltr />
          </Card>
          {quote.data.windowPassed ? <ErrorBanner message={t('bookings.detail.windowPassed')} /> : null}
          <ErrorBanner message={action.banner} />
          <SelectField
            label={t('bookings.detail.reason')}
            value={reasonCode}
            options={codes.map((c) => ({ value: c, label: enumLabel({ t, has }, 'cancellationReason', c) }))}
            onChange={setReason}
            error={action.fields['reasonCode']}
          />
          <Label>{t('bookings.detail.reasonText')}</Label>
          <Field value={text} onChangeText={setText} error={action.fields['reasonText']} />
          <Button
            title={t('bookings.detail.confirmCancel')}
            variant="destructive"
            loading={action.busy}
            disabled={quote.data.windowPassed || !reasonCode || (reasonCode === 'OTHER' && !text.trim())}
            onPress={confirm}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

/** `POST /bookings/{id}/dispute` — opens a linked complaint (api.md §8.14 / §8.15). */
function DisputeSheet({ booking, onClose, onDisputed }: { booking: BookingDto; onClose: () => void; onDisputed: (r: BookingDisputeResultDto) => void }) {
  const { t, has } = useI18n();
  const action = useAction(['category', 'subject', 'description', 'severity']);
  const settings = usePublicSettings();
  const categories = stringList(settingValue(settings.data, 'platform.complaint_categories'));
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const cat = category || (categories[0] ?? '');

  const submit = async () => {
    const res = await action.run(() =>
      api<BookingDisputeResultDto>(`/bookings/${booking.id}/dispute`, {
        method: 'POST',
        body: { category: cat, subject: subject.trim(), description: description.trim() },
      }),
    );
    if (!res) return;
    onDisputed(res);
    onClose();
  };

  return (
    <Sheet title={t('bookings.detail.dispute')} onClose={onClose}>
      <Muted>{t('bookings.detail.disputeHint')}</Muted>
      <View className="mt-3">
        <ErrorBanner message={action.banner} />
        <SelectField
          label={t('complaints.category')}
          value={cat}
          options={categories.map((c) => ({ value: c, label: enumLabel({ t, has }, 'complaintCategory', c) }))}
          onChange={setCategory}
          error={action.fields['category']}
        />
        <Label>{t('complaints.subject')}</Label>
        <Field value={subject} onChangeText={setSubject} error={action.fields['subject']} />
        <Label>{t('complaints.description')}</Label>
        <TextArea value={description} onChangeText={setDescription} error={action.fields['description']} />
        <Button
          title={t('bookings.detail.dispute')}
          loading={action.busy}
          disabled={!cat || subject.trim().length < 3 || description.trim().length < 10}
          onPress={() => void submit()}
        />
      </View>
    </Sheet>
  );
}

/**
 * Owner dispatch (api.md §8.14): `POST /bookings/{id}/assign-driver { driverProfileId }` ⧗ from the
 * vehicle's open assignments (approved drivers only), then `POST /bookings/{id}/ready` once the
 * pre-dispatch checks are done — the same two actions the web's BookingDetail offers the owner.
 */
function OwnerDispatchCard({ booking, onDone }: { booking: BookingDto; onDone: (message: string) => void }) {
  const { t } = useI18n();
  const action = useAction(['driverProfileId']);
  const drivers = useEligibleDrivers(booking.vehicleId, t('fleet.detail.primary'));
  const [driverId, setDriverId] = useState('');
  const chosen = driverId || (drivers.options[0]?.value ?? '');

  const assign = async () => {
    const res = await action.run(() =>
      api<BookingDto>(`/bookings/${booking.id}/assign-driver`, {
        method: 'POST',
        body: { driverProfileId: chosen },
        headers: { 'Idempotency-Key': idempotencyKey() },
      }),
    );
    if (!res) return;
    onDone(t('bookings.detail.assigned', { number: res.trip?.tripNumber ?? '' }));
  };
  const ready = async () => {
    const res = await action.run(() => api<BookingDto>(`/bookings/${booking.id}/ready`, { method: 'POST', body: {} }));
    if (!res) return;
    onDone(t('bookings.detail.readyDone'));
  };

  return (
    <Card>
      <Text className="text-base font-semibold text-card-foreground text-start">{t('bookings.detail.dispatch')}</Text>
      <View className="mt-3">
        <ErrorBanner message={action.banner} />
        {booking.status === 'CONFIRMED' ? (
          <>
            <SelectField
              label={t('bookings.detail.selectDriver')}
              value={chosen}
              options={drivers.options}
              onChange={setDriverId}
              placeholder={drivers.loading ? t('common.loading') : t('bookings.detail.noDrivers')}
              disabled={drivers.options.length === 0}
              error={action.fields['driverProfileId']}
            />
            {!drivers.loading && drivers.options.length === 0 ? <Muted>{t('bookings.detail.noDrivers')}</Muted> : null}
            <Button title={t('bookings.detail.assignDriver')} loading={action.busy} disabled={!chosen} onPress={() => void assign()} />
          </>
        ) : (
          <>
            <Muted>{t('bookings.detail.readyHint')}</Muted>
            <View className="mt-3">
              <Button title={t('bookings.detail.ready')} loading={action.busy} onPress={() => void ready()} />
            </View>
          </>
        )}
      </View>
    </Card>
  );
}
