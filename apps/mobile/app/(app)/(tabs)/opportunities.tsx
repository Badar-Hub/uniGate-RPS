import type { OpportunityDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';

/** Vendor: open invitations for the acting owner (`GET /opportunities`, api.md §8.12). */
export default function OpportunitiesScreen() {
  const { t } = useI18n();
  return (
    <ListScreen<OpportunityDto>
      title={t('lists.opportunities')}
      queryKey={['opportunities', { page: 1 }]}
      path="/opportunities"
      query={{ page: 1, pageSize: 20 }}
      toRow={(o) => ({
        id: o.id,
        title: o.request.requestNumber,
        subtitle: [
          o.matchScore ? t('lists.match', { score: o.matchScore }) : null,
          t('lists.vehicles', { count: o.request.vehiclesRequired }),
        ]
          .filter(Boolean)
          .join(' · '),
        status: o.request.biddingOpen ? t('lists.biddingOpen') : t('lists.biddingClosed'),
        date: o.request.biddingClosesAt,
        dateLabel: t('lists.closesAt'),
      })}
    />
  );
}
