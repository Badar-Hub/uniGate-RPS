import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { COMPLAINT_AGAINST_TYPE, COMPLAINT_SEVERITY, type BookingDto, type ComplaintDto } from '@unigate/types';
import { SelectField } from '@/components/select-field';
import { Button, ErrorBanner, Field, FormScreen, Label, Muted, TextArea } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, fetchOrThrow } from '@/lib/api';
import { keys, settingValue, stringList, useInvalidate, usePublicSettings } from '@/lib/queries';
import { enumLabel } from '@/lib/status';

const FIELDS = ['againstType', 'category', 'subject', 'description', 'severity', 'bookingId'];

/**
 * Raise a complaint (`POST /complaints`, api.md §8.25) — the same body as the web form:
 * against type, a category from `platform.complaint_categories`, subject, description, severity,
 * optionally the booking it concerns.
 */
export default function NewComplaintScreen() {
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const { t, has } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const action = useAction(FIELDS);
  const settings = usePublicSettings();
  const categories = stringList(settingValue(settings.data, 'platform.complaint_categories'));
  const bookings = useQuery({
    queryKey: [...keys.bookings, 'picker'],
    queryFn: () => fetchOrThrow<BookingDto[]>('/bookings', { query: { pageSize: 50 } }),
  });

  const [againstType, setAgainstType] = useState<string>('DRIVER');
  const [category, setCategory] = useState('');
  const [bookingId, setBookingId] = useState(typeof params.bookingId === 'string' ? params.bookingId : '');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState('MEDIUM');
  const cat = category || (categories[0] ?? '');

  const submit = async () => {
    const res = await action.run(() =>
      api<ComplaintDto>('/complaints', {
        method: 'POST',
        body: {
          againstType,
          category: cat,
          subject: subject.trim(),
          description: description.trim(),
          severity,
          ...(bookingId ? { bookingId } : {}),
        },
      }),
    );
    if (!res) return;
    await invalidate(keys.complaints);
    router.replace(`/complaints/${res.id}`);
  };

  return (
    <FormScreen>
      <Muted>{t('complaints.subtitle')}</Muted>
      <ErrorBanner message={action.banner} />
      <SelectField
        label={t('complaints.against')}
        value={againstType}
        options={COMPLAINT_AGAINST_TYPE.map((a) => ({ value: a, label: enumLabel({ t, has }, 'complaintAgainst', a) }))}
        onChange={setAgainstType}
        error={action.fields['againstType']}
      />
      <SelectField
        label={t('complaints.category')}
        value={cat}
        options={categories.map((c) => ({ value: c, label: enumLabel({ t, has }, 'complaintCategory', c) }))}
        onChange={setCategory}
        placeholder={settings.isPending ? t('common.loading') : t('common.choose')}
        error={action.fields['category']}
      />
      <SelectField
        label={t('complaints.booking')}
        value={bookingId}
        options={(bookings.data ?? []).map((b) => ({ value: b.id, label: b.bookingNumber, hint: `${b.vehicleDescriptionSnapshot} · ${b.vehiclePlateSnapshot}` }))}
        onChange={setBookingId}
        placeholder="—"
        clearable
        error={action.fields['bookingId']}
      />
      <Label>{t('complaints.subject')}</Label>
      <Field value={subject} onChangeText={setSubject} error={action.fields['subject']} />
      <SelectField
        label={t('complaints.severity')}
        value={severity}
        options={COMPLAINT_SEVERITY.map((s) => ({ value: s, label: enumLabel({ t, has }, 'complaintSeverity', s) }))}
        onChange={setSeverity}
        error={action.fields['severity']}
      />
      <Label>{t('complaints.description')}</Label>
      <TextArea value={description} onChangeText={setDescription} error={action.fields['description']} />
      <Button
        title={t('complaints.submit')}
        loading={action.busy}
        disabled={!cat || subject.trim().length < 3 || description.trim().length < 10}
        onPress={() => void submit()}
      />
    </FormScreen>
  );
}
