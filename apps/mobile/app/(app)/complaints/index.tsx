import { useState } from 'react';
import { useRouter } from 'expo-router';
import { COMPLAINT_STATUS, type ComplaintDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { IconButton } from '@/components/ui';
import { useI18n } from '@/i18n';
import { keys } from '@/lib/queries';
import { enumLabel, statusLabel, toneFor } from '@/lib/status';

/** The raiser's complaints (`GET /complaints`, api.md §8.25), status filter, + → raise. */
export default function ComplaintsScreen() {
  const { t, has } = useI18n();
  const router = useRouter();
  const [status, setStatus] = useState('');
  return (
    <ListScreen<ComplaintDto>
      header
      title={t('complaints.title')}
      queryKey={keys.complaints}
      path="/complaints"
      query={status ? { status } : {}}
      filters={[{ value: '', label: t('common.all') }, ...COMPLAINT_STATUS.map((s) => ({ value: s, label: statusLabel({ t, has }, 'complaint', s) }))]}
      filter={status}
      onFilter={setStatus}
      action={
        <IconButton
          icon="add-circle"
          label={t('complaints.raise')}
          onPress={() => {
            router.push('/complaints/new');
          }}
        />
      }
      onPress={(c) => {
        router.push(`/complaints/${c.id}`);
      }}
      toRow={(c) => ({
        id: c.id,
        title: c.subject,
        subtitle: `${c.complaintNumber} · ${enumLabel({ t, has }, 'complaintAgainst', c.againstType)} · ${enumLabel({ t, has }, 'complaintCategory', c.category)}${c.overdue ? ` · ${t('complaints.overdue')}` : ''}`,
        status: statusLabel({ t, has }, 'complaint', c.status),
        tone: toneFor('complaint', c.status),
        date: c.createdAt,
        dateLabel: t('complaints.raised'),
        trailing: enumLabel({ t, has }, 'complaintSeverity', c.severity),
      })}
    />
  );
}
