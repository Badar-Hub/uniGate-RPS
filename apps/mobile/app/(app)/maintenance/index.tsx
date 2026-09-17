import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { MAINTENANCE_STATUS, type MaintenanceDueDto, type MaintenanceRecordDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { Card, IconButton, Muted, Row, SectionTitle } from '@/components/ui';
import { useI18n } from '@/i18n';
import { fetchOrThrow } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import { keys } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

/**
 * Maintenance (api.md §8.23): the records (`GET /maintenance/records?status`) with the due panel
 * (`GET /maintenance/due`) on top, + → plan a workshop visit, tap → record (start / complete / cancel).
 */
export default function MaintenanceScreen() {
  const { t, has, locale } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');
  return (
    <ListScreen<MaintenanceRecordDto>
      header
      title={t('maintenance.title')}
      queryKey={keys.maintenanceRecords}
      path="/maintenance/records"
      query={status ? { status } : {}}
      filters={[{ value: '', label: t('common.all') }, ...MAINTENANCE_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'maintenance', s) }))]}
      filter={status}
      onFilter={setStatus}
      above={<DuePanel />}
      action={
        <IconButton
          icon="add-circle"
          label={t('maintenance.record')}
          onPress={() => {
            router.push('/maintenance/new');
          }}
        />
      }
      onPress={(r) => {
        router.push(`/maintenance/${r.id}`);
      }}
      toRow={(r) => ({
        id: r.id,
        title: r.vehiclePlate,
        subtitle: `${locale === 'ar' ? r.serviceTypeNameAr : r.serviceTypeNameEn} · ${t(`maintenance.kinds.${r.maintenanceKind}`)}${r.workshopName ? ` · ${r.workshopName}` : ''}`,
        status: statusLabel({ t, has }, 'maintenance', r.status),
        tone: toneFor('maintenance', r.status),
        date: r.scheduledStartAt,
        dateLabel: t('maintenance.from'),
        trailing: formatMoney(r.totalAmount, r.currency),
      })}
    />
  );
}

/** Vehicles past or approaching a schedule — the same query the reminder job runs. */
function DuePanel() {
  const { t, locale } = useI18n();
  const q = useQuery({
    queryKey: ['maintenance', 'due'] as const,
    queryFn: () => fetchOrThrow<MaintenanceDueDto[]>('/maintenance/due'),
  });
  if (!q.data?.length) return null;
  return (
    <View>
      <SectionTitle>{t('maintenance.due.title')}</SectionTitle>
      {q.data.map((d) => (
        <Card key={d.scheduleId}>
          <Row
            label={d.vehiclePlate}
            value={[
              locale === 'ar' ? d.serviceTypeNameAr : d.serviceTypeNameEn,
              d.overdue ? t('maintenance.due.overdue') : d.daysUntilDue !== null ? t('maintenance.due.inDays', { n: d.daysUntilDue }) : d.kmUntilDue !== null ? t('maintenance.due.inKm', { n: d.kmUntilDue }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            ltr
          />
          {d.nextDueAt ? <Muted ltr>{formatDate(d.nextDueAt, locale)}</Muted> : null}
        </Card>
      ))}
    </View>
  );
}
