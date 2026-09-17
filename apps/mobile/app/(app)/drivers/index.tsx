import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ONBOARDING_STATUS, type DriverDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { IconButton } from '@/components/ui';
import { useI18n } from '@/i18n';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/** The owner's drivers (`GET /drivers?approvalStatus`, api.md §8.6), + → register, tap → detail. */
export default function DriversScreen() {
  const { t, has, locale } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');
  return (
    <ListScreen<DriverDto>
      header
      title={t('drivers.title')}
      queryKey={keys.drivers}
      path="/drivers"
      query={status ? { approvalStatus: status } : {}}
      filters={[{ value: '', label: t('common.all') }, ...ONBOARDING_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'onboarding', s) }))]}
      filter={status}
      onFilter={setStatus}
      action={
        <IconButton
          icon="add-circle"
          label={t('drivers.add')}
          onPress={() => {
            router.push('/drivers/new');
          }}
        />
      }
      onPress={(d) => {
        router.push(`/drivers/${d.id}`);
      }}
      toRow={(d) => ({
        id: d.id,
        title: (locale === 'ar' ? d.fullNameAr : null) ?? d.fullNameEn,
        subtitle: [
          d.phoneE164,
          d.verticals.map((v) => `${t(`vertical.${v.transportType}`)} · ${statusLabel({ t, has }, 'vertical', v.status)}`).join(', '),
          d.licenseCategories.join(', '),
        ]
          .filter(Boolean)
          .join(' · '),
        status: statusLabel({ t, has }, 'onboarding', d.approvalStatus),
        tone: toneFor('onboarding', d.approvalStatus),
        date: d.licenseExpiryDate,
        dateLabel: t('drivers.form.licenseExpiryDate'),
        dateOnly: true,
        trailing: statusLabel({ t, has }, 'driverAvailability', d.availabilityStatus),
      })}
    />
  );
}
