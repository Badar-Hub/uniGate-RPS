import type { VehicleDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';

/** Vendor: the owner's vehicles (`GET /vehicles`, api.md §8.8). */
export default function FleetScreen() {
  const { t, locale } = useI18n();
  return (
    <ListScreen<VehicleDto>
      title={t('lists.fleet')}
      queryKey={['vehicles', { page: 1 }]}
      path="/vehicles"
      query={{ page: 1, pageSize: 20 }}
      toRow={(v) => ({
        id: v.id,
        title: v.plateNumberEn,
        subtitle: [
          v.make?.name,
          v.model?.name,
          String(v.modelYear),
          locale === 'ar' ? v.category.nameAr : v.category.nameEn,
        ]
          .filter(Boolean)
          .join(' · '),
        status: v.approvalStatus,
        date: v.updatedAt,
      })}
    />
  );
}
