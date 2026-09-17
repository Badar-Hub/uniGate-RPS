import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { TripRequestDto } from '@unigate/types';
import { RequestDetailCard, RequestRouteCard } from '@/components/request-cards';
import {
  Button,
  ErrorBanner,
  Field,
  Label,
  Muted,
  Notice,
  QueryState,
  Screen,
  SectionTitle,
  StatusBadge,
  Title,
} from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { countdown } from '@/lib/format';
import { keys, useInvalidate, useTripRequest } from '@/lib/queries';
import { BIDDABLE_REQUEST_STATUSES, statusLabel, toneFor } from '@/lib/status';

const MIN_REASON = 5;

/** One request (api.md §8.11): status, route, timing, bidding countdown, the detail block, publish / cancel / delete, and the way to its bids. */
export default function RequestDetailScreen() {
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const requestId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const q = useTripRequest(requestId);
  const action = useAction(['reason']);
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [acted, setActed] = useState(false);

  const r = q.data;
  // The "created" notice comes from the navigation param and stays until the first action replaces it.
  const createdNotice =
    r && created && !acted
      ? created === 'published'
        ? t('requests.form.published', { count: r.invitedOwnerCount })
        : created === 'draft'
          ? t('requests.form.created')
          : null
      : null;

  const act = async (path: 'publish' | 'cancel', body: Record<string, unknown> = {}) => {
    setActed(true);
    setNotice(null);
    const updated = await action.run(() =>
      api<TripRequestDto>(`/trip-requests/${requestId}/${path}`, { method: 'POST', body }),
    );
    if (!updated) return;
    await invalidate(keys.request(requestId), keys.requests);
    if (path === 'publish') setNotice(t('requests.form.published', { count: updated.invitedOwnerCount }));
    if (path === 'cancel') {
      setReason('');
      setNotice(t('requests.detail.cancelled'));
    }
  };

  const confirmCancel = () => {
    Alert.alert(t('requests.detail.cancel'), t('requests.detail.cancelConfirm'), [
      { text: t('common.back'), style: 'cancel' },
      { text: t('requests.detail.cancel'), style: 'destructive', onPress: () => void act('cancel', { reason: reason.trim() }) },
    ]);
  };

  const remove = () => {
    Alert.alert(t('requests.detail.delete'), t('requests.detail.deleteConfirm'), [
      { text: t('common.back'), style: 'cancel' },
      {
        text: t('requests.detail.delete'),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const ok = await action.run(() => api(`/trip-requests/${requestId}`, { method: 'DELETE' }));
            if (ok === null) return;
            await invalidate(keys.requests);
            router.back();
          })();
        },
      },
    ]);
  };

  return (
    <Screen header>
      <QueryState
        pending={q.isPending}
        error={q.isError ? errorMessage(apiErrorOf(q.error)) : null}
        retryLabel={t('common.retry')}
        onRetry={() => void q.refetch()}
      >
        {r ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{r.requestNumber}</Title>
                <Muted>
                  {r.vehicleCategory ? (locale === 'ar' ? r.vehicleCategory.nameAr : r.vehicleCategory.nameEn) : ''} ·{' '}
                  {t('requests.detail.awardedOf', { awarded: r.vehiclesAwarded, required: r.vehiclesRequired })}
                </Muted>
              </View>
              <View className="items-end gap-1">
                <StatusBadge label={statusLabel({ t, has }, 'request', r.status)} tone={toneFor('request', r.status)} />
                <StatusBadge label={r.biddingOpen ? t('lists.biddingOpen') : t('lists.biddingClosed')} tone={r.biddingOpen ? 'success' : 'neutral'} />
              </View>
            </View>

            <View className="mt-4">
              <Notice message={notice ?? createdNotice} />
              <ErrorBanner message={action.banner} />
            </View>

            {r.biddingOpen ? <Deadline until={r.biddingClosesAt} /> : null}

            <RequestRouteCard r={r} />
            <RequestDetailCard r={r} />

            {BIDDABLE_REQUEST_STATUSES.includes(r.status) ? (
              <View className="mt-4">
                <Button
                  title={t('requests.detail.viewBids')}
                  onPress={() => {
                    router.push(`/requests/${r.id}/bids`);
                  }}
                />
              </View>
            ) : null}

            {r.status === 'DRAFT' ? (
              <View className="mt-4 gap-3">
                <Button title={t('requests.detail.publish')} loading={action.busy} onPress={() => void act('publish')} />
                <Button title={t('requests.detail.delete')} variant="secondary" disabled={action.busy} onPress={remove} />
              </View>
            ) : null}

            {['DRAFT', 'PUBLISHED', 'PARTIALLY_AWARDED'].includes(r.status) && r.vehiclesAwarded === 0 ? (
              <>
                <SectionTitle>{t('requests.detail.cancel')}</SectionTitle>
                <Label>{t('requests.detail.cancelReason')}</Label>
                <Field value={reason} onChangeText={setReason} error={action.fields['reason']} placeholder={t('requests.detail.reasonHint', { min: MIN_REASON })} />
                <Button
                  title={t('requests.detail.cancel')}
                  variant="destructive"
                  disabled={action.busy || reason.trim().length < MIN_REASON}
                  onPress={confirmCancel}
                />
              </>
            ) : null}

            {r.cancellationReason ? (
              <View className="mt-4">
                <Muted>{t('requests.detail.cancelledReason', { reason: r.cancellationReason })}</Muted>
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}

/** Ticking "bids close in …" line. */
function Deadline({ until }: { until: string }) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);
  const c = countdown(until, now);
  const text =
    c.total === 0
      ? t('requests.detail.deadlinePassed')
      : c.days > 0
        ? t('requests.detail.closesInDays', { days: c.days, hours: c.hours })
        : t('requests.detail.closesIn', { hours: c.hours, minutes: c.minutes, seconds: c.seconds });
  return (
    <View className="mb-2 rounded-md bg-muted p-3">
      <Text className="text-sm font-medium text-foreground text-start">{text}</Text>
    </View>
  );
}
