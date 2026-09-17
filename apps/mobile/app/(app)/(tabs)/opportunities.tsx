import { useState } from 'react';
import { useRouter } from 'expo-router';
import type { OpportunityDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';
import { keys } from '@/lib/queries';

type Filter = '' | 'unbid' | 'bid' | 'dismissed';

/**
 * Vendor: open invitations for the acting owner (`GET /opportunities`, api.md §8.12), best
 * match first. The chips map to the API's filters: `hasBid=false` (still to bid), `hasBid=true`
 * (bid placed) and `includeDismissed=true` (the dismissed ones, shown greyed on the web).
 */
export default function OpportunitiesScreen() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('');
  const query =
    filter === 'unbid' ? { hasBid: false } : filter === 'bid' ? { hasBid: true } : filter === 'dismissed' ? { includeDismissed: true } : {};

  return (
    <ListScreen<OpportunityDto>
      title={t('lists.opportunities')}
      queryKey={keys.opportunities}
      path="/opportunities"
      query={query}
      filters={[
        { value: '', label: t('common.all') },
        { value: 'unbid', label: t('opportunities.filter.unbid') },
        { value: 'bid', label: t('opportunities.filter.bid') },
        { value: 'dismissed', label: t('opportunities.filter.dismissed') },
      ]}
      filter={filter}
      onFilter={(v) => {
        setFilter(v as Filter);
      }}
      onPress={(o) => {
        router.push(`/opportunities/${o.id}`);
      }}
      toRow={(o) => {
        const r = o.request;
        const category = r.vehicleCategory ? (locale === 'ar' ? r.vehicleCategory.nameAr : r.vehicleCategory.nameEn) : r.transportType;
        return {
          id: o.id,
          title: r.requestNumber,
          subtitle: [
            category,
            `${r.pickup.addressLine} → ${r.dropoff.addressLine}`,
            t('lists.vehicles', { count: r.vehiclesRequired - r.vehiclesAwarded }),
            o.matchScore ? t('lists.match', { score: o.matchScore }) : null,
          ]
            .filter(Boolean)
            .join(' · '),
          status: o.dismissedAt
            ? t('opportunities.dismissed')
            : o.ownBidId
              ? t('opportunities.yourBid')
              : r.biddingOpen
                ? t('lists.biddingOpen')
                : t('lists.biddingClosed'),
          tone: o.dismissedAt ? 'neutral' : o.ownBidId ? 'info' : r.biddingOpen ? 'success' : 'neutral',
          date: r.pickupAt,
          dateLabel: t('lists.pickupAt'),
          trailing: o.eligibleVehicles.length ? t('opportunities.eligibleCount', { count: o.eligibleVehicles.length }) : undefined,
        };
      }}
    />
  );
}
