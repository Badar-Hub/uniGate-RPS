import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import type { ComplaintDto } from '@unigate/types';
import { Button, Card, ErrorBanner, Field, Muted, QueryState, Row, Screen, SectionTitle, StatusBadge, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf, fetchOrThrow } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { keys, useInvalidate } from '@/lib/queries';
import { enumLabel, statusLabel, toneFor } from '@/lib/status';

/** One complaint (`GET /complaints/{id}`, api.md §8.25) with its thread; a reply is `POST /complaints/{id}/notes`. */
export default function ComplaintDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const complaintId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const invalidate = useInvalidate();
  const action = useAction(['body']);
  const [reply, setReply] = useState('');
  const q = useQuery({
    queryKey: keys.complaint(complaintId),
    queryFn: () => fetchOrThrow<ComplaintDto>(`/complaints/${complaintId}`),
    enabled: complaintId.length > 0,
  });
  const c = q.data;

  const send = async () => {
    const res = await action.run(() =>
      api<ComplaintDto>(`/complaints/${complaintId}/notes`, { method: 'POST', body: { body: reply.trim(), isInternal: false } }),
    );
    if (!res) return;
    setReply('');
    await invalidate(keys.complaint(complaintId), keys.complaints);
  };

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {c ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="py-4 pb-12">
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title>{c.subject}</Title>
                <Muted ltr>{c.complaintNumber}</Muted>
              </View>
              <StatusBadge label={statusLabel({ t, has }, 'complaint', c.status)} tone={toneFor('complaint', c.status)} />
            </View>
            <View className="mt-4">
              <Card>
                <Text className="text-base text-card-foreground text-start">{c.description}</Text>
              </Card>
              <Card>
                <Row label={t('complaints.against')} value={enumLabel({ t, has }, 'complaintAgainst', c.againstType)} />
                <Row label={t('complaints.category')} value={enumLabel({ t, has }, 'complaintCategory', c.category)} />
                <Row label={t('complaints.severity')} value={enumLabel({ t, has }, 'complaintSeverity', c.severity)} />
                {c.bookingNumber ? <Row label={t('complaints.booking')} value={c.bookingNumber} ltr /> : null}
                <Row label={t('complaints.raised')} value={formatDateTime(c.createdAt, locale)} ltr />
                {c.respondBy ? <Row label={t('complaints.respondBy')} value={formatDateTime(c.respondBy, locale)} ltr /> : null}
                {c.overdue ? <Row label={t('complaints.status')} value={t('complaints.overdue')} /> : null}
                {c.resolution ? <Row label={t('complaints.resolution')} value={c.resolution} /> : null}
              </Card>
            </View>

            <SectionTitle>{t('complaints.thread')}</SectionTitle>
            {c.notes.length === 0 ? (
              <Muted>{t('complaints.noNotes')}</Muted>
            ) : (
              c.notes.map((n) => (
                <Card key={n.id}>
                  <Muted>
                    {n.authorName} · {formatDateTime(n.createdAt, locale)}
                  </Muted>
                  <Text className="mt-1 text-base text-card-foreground text-start">{n.body}</Text>
                </Card>
              ))
            )}
            {c.status !== 'CLOSED' ? (
              <View className="mt-3">
                <ErrorBanner message={action.banner} />
                <Field value={reply} onChangeText={setReply} placeholder={t('complaints.reply')} error={action.fields['body']} />
                <Button title={t('complaints.send')} loading={action.busy} disabled={!reply.trim()} onPress={() => void send()} />
              </View>
            ) : null}
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
