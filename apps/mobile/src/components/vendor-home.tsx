import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { BidDto, BookingDto, OpportunityDto, SettlementDto, VehicleDto } from '@unigate/types';
import { Card, ErrorBanner, LinkRow, Loading, Muted, SectionTitle, StatTile } from '@/components/ui';
import { useI18n } from '@/i18n';
import { apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatCount, formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { summariseVendorHome } from '@/lib/home-summary';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/**
 * The owner's Home summary: open opportunities (and how many still lack a bid), bids awaiting a
 * decision, upcoming bookings with the next one and those needing dispatch, vehicles needing
 * attention (not dispatchable, documents / dates expiring) and the last settlement. There is no
 * vendor dashboard endpoint, so the tabs' own lists are read (one page each) and aggregated on
 * the device (`src/lib/home-summary.ts`).
 */
export function VendorHome() {
  const { t, has, locale, isRTL, errorMessage } = useI18n();
  const router = useRouter();
  const opportunities = useQuery({ queryKey: [...keys.opportunities, 'home'] as const, queryFn: () => fetchOrThrow<OpportunityDto[]>('/opportunities', { query: { page: 1, pageSize: 100 } }) });
  const bids = useQuery({ queryKey: [...keys.bids, 'home'] as const, queryFn: () => fetchOrThrow<BidDto[]>('/bids', { query: { page: 1, pageSize: 100, status: 'SUBMITTED' } }) });
  const bookings = useQuery({ queryKey: [...keys.bookings, 'home'] as const, queryFn: () => fetchOrThrow<BookingDto[]>('/bookings', { query: { page: 1, pageSize: 100 } }) });
  const vehicles = useQuery({ queryKey: [...keys.vehicles, 'home'] as const, queryFn: () => fetchOrThrow<VehicleDto[]>('/vehicles', { query: { page: 1, pageSize: 100 } }) });
  const settlements = useQuery({ queryKey: [...keys.settlements, 'home'] as const, queryFn: () => fetchOrThrow<SettlementDto[]>('/settlements', { query: { page: 1, pageSize: 5 } }) });

  const summary = useMemo(
    () =>
      summariseVendorHome({
        opportunities: opportunities.data ?? [],
        bids: bids.data ?? [],
        bookings: bookings.data ?? [],
        vehicles: vehicles.data ?? [],
        settlements: settlements.data ?? [],
      }),
    [opportunities.data, bids.data, bookings.data, vehicles.data, settlements.data],
  );
  const pending = opportunities.isPending || bids.isPending || bookings.isPending || vehicles.isPending;
  const failed = [opportunities, bids, bookings, vehicles, settlements].find((q) => q.isError);

  if (pending) return <Loading />;

  return (
    <View className="mt-4">
      {failed ? <ErrorBanner message={t('home.partial', { reason: errorMessage(apiErrorOf(failed.error)) })} /> : null}
      <View className="flex-row flex-wrap gap-2">
        <StatTile value={formatCount(summary.openOpportunities, locale)} label={summary.unbidOpportunities ? t('home.owner.openOpportunitiesUnbid', { count: summary.unbidOpportunities }) : t('home.owner.openOpportunities')} tone={summary.unbidOpportunities ? 'info' : 'neutral'} onPress={() => { router.push('/(app)/(tabs)/opportunities'); }} />
        <StatTile value={formatCount(summary.bidsAwaitingDecision, locale)} label={t('home.owner.bidsAwaiting')} onPress={() => { router.push('/bids'); }} />
        <StatTile value={formatCount(summary.upcomingBookings, locale)} label={summary.bookingsNeedingAction ? t('home.owner.bookingsNeedingAction', { count: summary.bookingsNeedingAction }) : t('home.owner.upcomingBookings')} tone={summary.bookingsNeedingAction ? 'warning' : 'neutral'} onPress={() => { router.push('/(app)/(tabs)/bookings'); }} />
        <StatTile value={formatCount(summary.vehiclesAttention.length, locale)} label={t('home.owner.vehiclesAttention', { total: summary.vehiclesTotal })} tone={summary.vehiclesAttention.length ? 'danger' : 'success'} onPress={() => { router.push('/(app)/(tabs)/fleet'); }} />
      </View>

      {summary.nextBooking ? (
        <>
          <SectionTitle>{t('home.owner.nextBooking')}</SectionTitle>
          <LinkRow
            title={summary.nextBooking.bookingNumber}
            subtitle={`${formatDateTime(summary.nextBooking.scheduledStartAt, locale)} · ${summary.nextBooking.vehiclePlateSnapshot} · ${statusLabel({ t, has }, 'booking', summary.nextBooking.status)}`}
            icon="calendar-outline"
            rtl={isRTL}
            onPress={() => {
              router.push(`/bookings/${summary.nextBooking?.id ?? ''}`);
            }}
          />
        </>
      ) : null}

      {summary.vehiclesAttention.length ? (
        <>
          <SectionTitle>{t('home.owner.attentionTitle')}</SectionTitle>
          {summary.vehiclesAttention.slice(0, 5).map((v) => (
            <LinkRow
              key={v.vehicleId}
              title={v.plate}
              subtitle={v.reasons.map((r) => (has(`fleet.reasons.${r}`) ? t(`fleet.reasons.${r}`) : r)).join(' · ')}
              icon="warning-outline"
              rtl={isRTL}
              onPress={() => {
                router.push(`/fleet/${v.vehicleId}`);
              }}
            />
          ))}
        </>
      ) : null}

      <SectionTitle>{t('home.owner.lastSettlement')}</SectionTitle>
      {summary.lastSettlement ? (
        <LinkRow
          title={summary.lastSettlement.settlementNumber}
          subtitle={`${formatDate(summary.lastSettlement.periodStart, locale)} – ${formatDate(summary.lastSettlement.periodEnd, locale)} · ${statusLabel({ t, has }, 'settlement', summary.lastSettlement.status)}`}
          icon="wallet-outline"
          rtl={isRTL}
          trailing={
            <Text className={`text-sm font-semibold ${toneFor('settlement', summary.lastSettlement.status) === 'success' ? 'text-primary' : 'text-card-foreground'}`} style={{ writingDirection: 'ltr' }}>
              {formatMoney(summary.lastSettlement.netPayableAmount, summary.lastSettlement.currency)}
            </Text>
          }
          onPress={() => {
            router.push(`/settlements/${summary.lastSettlement?.id ?? ''}`);
          }}
        />
      ) : (
        <Card>
          <Muted>{t('home.owner.noSettlement')}</Muted>
        </Card>
      )}
    </View>
  );
}
