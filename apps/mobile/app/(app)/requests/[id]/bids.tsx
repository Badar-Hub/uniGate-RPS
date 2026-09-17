import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { idempotencyKey } from '@unigate/api-client';
import type { AcceptBidResultDto, AwardResultDto, BidDto } from '@unigate/types';
import {
  Button,
  Card,
  Chip,
  Empty,
  ErrorBanner,
  Field,
  Loading,
  Muted,
  Notice,
  Screen,
  StatusBadge,
  usePalette,
} from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { keys, useInvalidate, useTripRequest } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { statusLabel, toneFor } from '@/lib/status';

type Sort = 'total' | 'rating' | 'eta';

/**
 * The customer's comparison list (api.md §8.11 `GET /trip-requests/{id}/bids`): owner, rating,
 * vehicle, total with its breakdown, extras, notes, ETA; sort by total / rating / arrival.
 * Accept (`POST /bids/{id}/accept`, ⧗) for partial-fulfilment orders, or the all-or-nothing group
 * award (`POST /trip-requests/{id}/award`, ⧗) when the request must be filled as a whole;
 * reject with an optional reason (`POST /bids/{id}/reject`).
 */
export default function RequestBidsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const { me, can } = useSession();
  const router = useRouter();
  const colors = usePalette();
  const invalidate = useInvalidate();
  const action = useAction();
  const [sort, setSort] = useState<Sort>('total');
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const request = useTripRequest(requestId);
  const bids = useQuery({
    queryKey: keys.requestBids(requestId),
    queryFn: () => fetchOrThrow<BidDto[]>(`/trip-requests/${requestId}/bids`, { query: { pageSize: 100 } }),
    enabled: requestId.length > 0,
  });

  const r = request.data;
  const remainder = r ? r.vehiclesRequired - r.vehiclesAwarded : 0;
  const groupOnly = Boolean(r && !r.allowPartialFulfilment && r.vehiclesRequired > 1);
  const open = Boolean(r?.biddingOpen && remainder > 0);
  const canAccept = Boolean(r && can('bids.accept') && (r.customerProfileId === me?.profiles.customer?.id || can('trip_requests.read_any')));

  const rows = useMemo(() => {
    const list = [...(bids.data ?? [])];
    const num = (s: string | null | undefined) => Number(s ?? 0);
    list.sort((a, b) => {
      if (sort === 'rating') return num(b.ownerRatingAvg) - num(a.ownerRatingAvg);
      if (sort === 'eta') {
        const ea = a.estimatedArrivalAt ? new Date(a.estimatedArrivalAt).getTime() : Number.POSITIVE_INFINITY;
        const eb = b.estimatedArrivalAt ? new Date(b.estimatedArrivalAt).getTime() : Number.POSITIVE_INFINITY;
        return ea - eb;
      }
      return num(a.totalAmount) - num(b.totalAmount);
    });
    return list;
  }, [bids.data, sort]);

  const refresh = () => invalidate(keys.requestBids(requestId), keys.request(requestId), keys.requests, keys.bookings);

  const accept = (b: BidDto) => {
    Alert.alert(t('bids.accept'), t('bids.acceptConfirm', { owner: b.ownerName, total: formatMoney(b.totalAmount, b.currency) }), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('bids.accept'),
        onPress: () => {
          void (async () => {
            setNotice(null);
            const res = await action.run(() =>
              api<AcceptBidResultDto>(`/bids/${b.id}/accept`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': idempotencyKey() } }),
            );
            if (!res) return;
            await refresh();
            setNotice(t('bids.accepted', { number: res.booking.bookingNumber }));
            router.push(`/bookings/${res.booking.id}`);
          })();
        },
      },
    ]);
  };

  const award = () => {
    Alert.alert(t('bids.awardSelected', { count: selected.length }), t('bids.awardConfirm', { count: selected.length }), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('bids.award'),
        onPress: () => {
          void (async () => {
            setNotice(null);
            const res = await action.run(() =>
              api<AwardResultDto>(`/trip-requests/${requestId}/award`, {
                method: 'POST',
                body: { bidIds: selected },
                headers: { 'Idempotency-Key': idempotencyKey() },
              }),
            );
            if (!res) return;
            setSelected([]);
            await refresh();
            setNotice(t('bids.awarded', { count: res.bookings.length }));
          })();
        },
      },
    ]);
  };

  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const reject = async (b: BidDto, reason: string) => {
    setNotice(null);
    const res = await action.run(() =>
      api<BidDto>(`/bids/${b.id}/reject`, { method: 'POST', body: reason.trim() ? { reason: reason.trim() } : {} }),
    );
    if (!res) return;
    setRejecting(null);
    await refresh();
  };

  const toggle = (bidId: string) => {
    setSelected((s) => (s.includes(bidId) ? s.filter((x) => x !== bidId) : [...s, bidId]));
  };

  const pending = request.isPending || bids.isPending;
  const error = request.isError ? errorMessage(apiErrorOf(request.error)) : bids.isError ? errorMessage(apiErrorOf(bids.error)) : null;

  return (
    <Screen header>
      {pending ? (
        <Loading />
      ) : error ? (
        <View className="py-4">
          <ErrorBanner message={error} />
          <Button title={t('common.retry')} variant="secondary" onPress={() => void Promise.all([request.refetch(), bids.refetch()])} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(b) => b.id}
          refreshControl={<RefreshControl refreshing={bids.isRefetching} onRefresh={() => void refresh()} tintColor={colors.primary} />}
          contentContainerClassName="py-4 pb-24"
          ListHeaderComponent={
            <View>
              <Muted>{groupOnly && open ? t('bids.awardHint', { count: remainder }) : t('bids.subtitle')}</Muted>
              <View className="mt-3 flex-row">
                <Chip label={t('bids.sortTotal')} active={sort === 'total'} onPress={() => { setSort('total'); }} />
                <Chip label={t('bids.sortRating')} active={sort === 'rating'} onPress={() => { setSort('rating'); }} />
                <Chip label={t('bids.sortEta')} active={sort === 'eta'} onPress={() => { setSort('eta'); }} />
              </View>
              <Notice message={notice} />
              <ErrorBanner message={action.banner} />
            </View>
          }
          ListEmptyComponent={<Empty text={t('bids.empty')} />}
          renderItem={({ item: b }) => {
            const live = b.status === 'SUBMITTED';
            const isSelected = selected.includes(b.id);
            return (
              <Card>
                <View className="flex-row items-start justify-between gap-2">
                  <View className="flex-1">
                    <Text className="text-base font-semibold text-card-foreground text-start">{b.ownerName}</Text>
                    <Text className="text-sm text-muted-foreground text-start" style={{ writingDirection: 'ltr' }}>
                      ★ {b.ownerRatingAvg} · {b.vehicle.plateNumberEn} · {b.vehicle.description}
                    </Text>
                  </View>
                  <StatusBadge label={statusLabel({ t, has }, 'bid', b.status)} tone={toneFor('bid', b.status)} />
                </View>
                <View className="mt-2 flex-row items-baseline justify-between">
                  <Text className="text-xs text-muted-foreground">{t('bids.total')}</Text>
                  <Text className="text-lg font-bold text-card-foreground" style={{ writingDirection: 'ltr' }}>
                    {formatMoney(b.totalAmount, b.currency)}
                  </Text>
                </View>
                <Text className="text-xs text-muted-foreground text-end" style={{ writingDirection: 'ltr' }}>
                  {formatMoney(b.baseAmount)} + {formatMoney(b.extrasAmount)} + VAT {formatMoney(b.vatAmount)}
                </Text>
                {b.extrasBreakdown.length ? (
                  <View className="mt-1">
                    {b.extrasBreakdown.map((x, i) => (
                      <Text key={i} className="text-xs text-muted-foreground text-start">
                        {locale === 'ar' ? x.labelAr : x.labelEn}: {formatMoney(x.amount)}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {b.estimatedArrivalAt ? (
                  <Muted ltr>{t('bids.arrival')}: {formatDateTime(b.estimatedArrivalAt, locale)}</Muted>
                ) : null}
                <Muted ltr>{t('bids.validUntil')}: {formatDateTime(b.validUntil, locale)}</Muted>
                {b.ownerNotes ? <Text className="mt-1 text-sm text-card-foreground text-start">{b.ownerNotes}</Text> : null}

                {canAccept && live && open ? (
                  <View className="mt-3 flex-row items-center gap-2">
                    {groupOnly ? (
                      <Pressable
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isSelected }}
                        onPress={() => {
                          toggle(b.id);
                        }}
                        className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-md border border-primary"
                      >
                        <Ionicons name={isSelected ? 'checkbox' : 'square-outline'} size={20} color={colors.primary} />
                        <Text className="text-base font-semibold text-primary">{t('bids.select')}</Text>
                      </Pressable>
                    ) : (
                      <View className="flex-1">
                        <Button title={t('bids.accept')} loading={action.busy} onPress={() => { accept(b); }} />
                      </View>
                    )}
                    <View className="flex-1">
                      <Button
                        title={t('bids.reject')}
                        variant="secondary"
                        disabled={action.busy}
                        onPress={() => {
                          setRejecting((x) => (x?.id === b.id ? null : { id: b.id, reason: '' }));
                        }}
                      />
                    </View>
                  </View>
                ) : null}
                {rejecting?.id === b.id ? (
                  <View className="mt-3">
                    <Field
                      value={rejecting.reason}
                      onChangeText={(v) => {
                        setRejecting({ id: b.id, reason: v });
                      }}
                      placeholder={t('bids.rejectReason')}
                    />
                    <Button title={t('bids.rejectConfirm')} variant="destructive" loading={action.busy} onPress={() => void reject(b, rejecting.reason)} />
                  </View>
                ) : null}
                {b.status === 'ACCEPTED' && b.bookingId ? (
                  <View className="mt-3">
                    <Button
                      title={t('bids.booked')}
                      variant="secondary"
                      onPress={() => {
                        router.push(`/bookings/${b.bookingId ?? ''}`);
                      }}
                    />
                  </View>
                ) : null}
              </Card>
            );
          }}
        />
      )}
      {groupOnly && canAccept && open && rows.length > 0 ? (
        <View className="absolute inset-x-4 bottom-4">
          <Button
            title={t('bids.awardSelected', { count: selected.length })}
            disabled={action.busy || selected.length !== remainder}
            loading={action.busy}
            onPress={award}
          />
        </View>
      ) : null}
    </Screen>
  );
}
