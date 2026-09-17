import { useState } from 'react';
import { useRouter } from 'expo-router';
import { VEHICLE_APPROVAL_STATUS, type VehicleDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { IconButton } from '@/components/ui';
import { useI18n } from '@/i18n';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/**
 * Vendor: the owner's vehicles (`GET /vehicles?approvalStatus`, api.md §8.8) with the approval
 * badge and the dispatchability line, + → register, tap → vehicle detail.
 */
export default function FleetScreen() {
  const { t, has, locale } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');
  return (
    <ListScreen<VehicleDto>
      title={t('lists.fleet')}
      queryKey={keys.vehicles}
      path="/vehicles"
      query={status ? { approvalStatus: status } : {}}
      filters={[{ value: '', label: t('common.all') }, ...VEHICLE_APPROVAL_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'vehicleApproval', s) }))]}
      filter={status}
      onFilter={setStatus}
      action={
        <IconButton
          icon="add-circle"
          label={t('fleet.register')}
          onPress={() => {
            router.push('/fleet/new');
          }}
        />
      }
      onPress={(v) => {
        router.push(`/fleet/${v.id}`);
      }}
      toRow={(v) => ({
        id: v.id,
        title: v.plateNumberEn,
        subtitle: [
          [v.make?.name, v.model?.name, String(v.modelYear)].filter(Boolean).join(' '),
          locale === 'ar' ? v.category.nameAr : v.category.nameEn,
          statusLabel({ t, has }, 'vehicleLifecycle', v.lifecycleStatus),
        ]
          .filter(Boolean)
          .join(' · '),
        status: statusLabel({ t, has }, 'vehicleApproval', v.approvalStatus),
        tone: toneFor('vehicleApproval', v.approvalStatus),
        date: v.updatedAt,
        trailing: v.dispatchable.ok ? t('fleet.dispatchable') : t('fleet.notDispatchable'),
      })}
    />
  );
}
