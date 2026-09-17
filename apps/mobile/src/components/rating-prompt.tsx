import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { RatingDto, RatingEligibleBookingDto, RatingEligibleSubjectDto } from '@unigate/types';
import { Button, Card, ErrorBanner, Field, Muted, SectionTitle, Stars } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, fetchOrThrow } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { keys, useInvalidate } from '@/lib/queries';
import { useSession } from '@/lib/session';
import { enumLabel } from '@/lib/status';

/**
 * "Rate your trip" (api.md §8.24): `GET /ratings/eligible` says which completed bookings the
 * actor may still rate and which subjects remain; one star row + comment per subject →
 * `POST /ratings { bookingId, raterRole, subjectType, subjectId, score, comment? }`. Rendered
 * on a COMPLETED booking; nothing is drawn when there is nothing left to rate.
 */
export function RatingPrompt({ bookingId }: { bookingId: string }) {
  const { t, has, locale } = useI18n();
  const { can } = useSession();
  const invalidate = useInvalidate();
  const action = useAction(['score', 'comment']);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});

  const q = useQuery({
    queryKey: keys.ratingsEligible,
    queryFn: () => fetchOrThrow<RatingEligibleBookingDto[]>('/ratings/eligible'),
    enabled: can('ratings.create'),
  });
  const items = (q.data ?? []).filter((b) => b.bookingId === bookingId);
  if (!items.length && !action.banner) return null;

  const keyOf = (b: RatingEligibleBookingDto, s: RatingEligibleSubjectDto) => `${b.bookingId}:${b.raterRole}:${s.subjectType}:${s.subjectId}`;

  const submit = async (b: RatingEligibleBookingDto, s: RatingEligibleSubjectDto) => {
    const k = keyOf(b, s);
    const score = scores[k];
    if (!score) return;
    const comment = comments[k]?.trim();
    const res = await action.run(() =>
      api<RatingDto>('/ratings', {
        method: 'POST',
        body: { bookingId: b.bookingId, raterRole: b.raterRole, subjectType: s.subjectType, subjectId: s.subjectId, score, ...(comment ? { comment } : {}) },
      }),
    );
    if (res) await invalidate(keys.ratingsEligible);
  };

  return (
    <View>
      <SectionTitle>{t('ratings.section')}</SectionTitle>
      <ErrorBanner message={action.banner} />
      {items.map((b) => (
        <Card key={`${b.bookingId}:${b.raterRole}`}>
          <Text className="text-base font-semibold text-card-foreground text-start">{t('ratings.title', { booking: b.bookingNumber })}</Text>
          <Muted>{t('ratings.deadline', { date: formatDate(b.deadline, locale) })}</Muted>
          {b.subjects.map((s) => {
            const k = keyOf(b, s);
            return (
              <View key={k} className="mt-3 border-t border-border pt-3">
                <Text className="text-sm text-muted-foreground text-start">{enumLabel({ t, has }, 'ratingSubject', s.subjectType)}</Text>
                <Text className="text-base text-card-foreground text-start" style={{ writingDirection: 'ltr' }}>{s.label}</Text>
                {s.alreadyRated ? (
                  <Muted>{t('ratings.rated')}</Muted>
                ) : (
                  <View className="mt-2">
                    <Stars value={scores[k] ?? 0} onChange={(v) => { setScores({ ...scores, [k]: v }); }} label={s.label} />
                    <View className="mt-2">
                      <Field placeholder={t('ratings.comment')} value={comments[k] ?? ''} onChangeText={(v) => { setComments({ ...comments, [k]: v }); }} />
                    </View>
                    <Button title={t('ratings.submit')} disabled={!scores[k]} loading={action.busy} onPress={() => void submit(b, s)} />
                  </View>
                )}
              </View>
            );
          })}
        </Card>
      ))}
    </View>
  );
}
