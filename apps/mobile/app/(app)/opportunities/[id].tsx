import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { OpportunityDto } from '@unigate/types';
import { RequestDetailCard, RequestRouteCard } from '@/components/request-cards';
import { Badge, Button, Card, ErrorBanner, Muted, Notice, QueryState, Row, Screen, SectionTitle, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { countdown } from '@/lib/format';
import { keys, useInvalidate, useOpportunity } from '@/lib/queries';

/**
 * One opportunity (`GET /opportunities/{id}`, api.md §8.12): the redacted request (route,
 * timing, the passenger or goods block), the match score, the owner's eligible vehicles, the
 * way to their existing bid or to a new one, and dismiss / undo (`POST …/dismiss?undo=`).
 * Reading it marks `viewedAt` on the API side.
 */
export default function OpportunityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const opportunityId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const q = useOpportunity(opportunityId);
  const action = useAction();
  const [notice, setNotice] = useState<string | null>(null);

  const o = q.data;

  const dismiss = async (undo: boolean) => {
    setNotice(null);
    const res = await action.run(() =>
      api<OpportunityDto>(`/opportunities/${opportunityId}/dismiss`, { method: 'POST', body: {}, query: undo ? { undo: true } : {} }),
    );
    if (!res) return;
    await invalidate(keys.opportunity(opportunityId), keys.opportunities);
    setNotice(undo ? t('opportunities.restored') : t('opportunities.dismissedNotice'));
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {o ? (
          <ScrollView contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{o.request.requestNumber}</Title>
                <Muted>
                  {o.request.vehicleCategory ? (locale === 'ar' ? o.request.vehicleCategory.nameAr : o.request.vehicleCategory.nameEn) : t(`vertical.${o.request.transportType}`)} ·{' '}
                  {t('lists.vehicles', { count: o.request.vehiclesRequired - o.request.vehiclesAwarded })}
                </Muted>
              </View>
              <View className="items-end gap-1">
                <StatusBadge label={o.request.biddingOpen ? t('lists.biddingOpen') : t('lists.biddingClosed')} tone={o.request.biddingOpen ? 'success' : 'neutral'} />
                {o.matchScore ? <StatusBadge label={t('lists.match', { score: o.matchScore })} tone="info" /> : null}
                {o.dismissedAt ? <StatusBadge label={t('opportunities.dismissed')} tone="neutral" /> : null}
              </View>
            </View>

            <View className="mt-4">
              <Notice message={notice} />
              <ErrorBanner message={action.banner} />
            </View>

            {o.request.biddingOpen ? <Deadline until={o.request.biddingClosesAt} /> : null}

            {o.ownBidId ? (
              <Card>
                <Text className="text-base font-semibold text-card-foreground text-start">{t('opportunities.yourBidPlaced')}</Text>
                <View className="mt-3">
                  <Button
                    title={t('opportunities.yourBid')}
                    onPress={() => {
                      router.push(`/bids/${o.ownBidId ?? ''}`);
                    }}
                  />
                </View>
              </Card>
            ) : (
              <View className="mb-3">
                <Button
                  title={t('opportunities.placeBid')}
                  disabled={!o.request.biddingOpen || o.eligibleVehicles.length === 0 || Boolean(o.dismissedAt)}
                  onPress={() => {
                    router.push({ pathname: '/bids/new', params: { opportunityId: o.id } });
                  }}
                />
                {o.eligibleVehicles.length === 0 ? <Muted>{t('opportunities.noEligible')}</Muted> : null}
              </View>
            )}

            <RequestRouteCard r={o.request} />
            <RequestDetailCard r={o.request} />

            <SectionTitle>{t('opportunities.eligible')}</SectionTitle>
            <Card>
              {o.eligibleVehicles.length === 0 ? (
                <Muted>{t('opportunities.noEligible')}</Muted>
              ) : (
                o.eligibleVehicles.map((v) => (
                  <Row
                    key={v.id}
                    label={v.plateNumberEn}
                    value={[v.categoryCode, v.passengerCapacity ? t('requests.form.seats', { count: v.passengerCapacity }) : null, v.payloadCapacityKg ? t('requests.form.payload', { kg: v.payloadCapacityKg }) : null].filter(Boolean).join(' · ')}
                    ltr
                  />
                ))
              )}
            </Card>

            {matchReasons(o.matchReason).length ? (
              <>
                <SectionTitle>{t('opportunities.matchReason')}</SectionTitle>
                <View className="flex-row flex-wrap gap-2">
                  {matchReasons(o.matchReason).map((k) => (
                    <Badge key={k}>{has(`opportunities.reasons.${k}`) ? t(`opportunities.reasons.${k}`) : k}</Badge>
                  ))}
                </View>
              </>
            ) : null}

            <View className="mt-6">
              <Button
                title={o.dismissedAt ? t('opportunities.undo') : t('opportunities.dismiss')}
                variant="secondary"
                loading={action.busy}
                onPress={() => void dismiss(Boolean(o.dismissedAt))}
              />
            </View>
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}

/** `matchReason` is `{ reasons: string[], vehiclePlate? }` from the matching service; codes such as `LATE:REMATCH` keep their prefix. */
function matchReasons(reason: Record<string, unknown>): string[] {
  const list = reason['reasons'];
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').map((x) => x.split(':')[0] ?? x) : [];
}

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
    <View className="mb-3 rounded-md bg-muted p-3">
      <Text className="text-sm font-medium text-foreground text-start">{text}</Text>
    </View>
  );
}
