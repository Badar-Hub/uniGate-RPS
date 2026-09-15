'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Star } from 'lucide-react';
import type { RatingDto, RatingEligibleBookingDto, RatingEligibleSubjectDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const fmt = (locale: string, iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

function Stars({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div className="flex items-center gap-0.5" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n}`} className="p-0.5" onClick={() => { onChange(n); }}>
          <Star className={`size-5 ${n <= value ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
        </button>
      ))}
    </div>
  );
}

/**
 * "Rate your trip" (api.md §8.24): the API says which completed bookings the actor may still
 * rate and which subjects remain; one card per booking, one star row per subject. Pass
 * `bookingId` to show a single booking's prompt on its detail page.
 */
export function RatingPrompt({ bookingId }: { bookingId?: string | undefined } = {}) {
  const t = useTranslations('portal.engagement.ratings');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useSession();
  const [items, setItems] = useState<RatingEligibleBookingDto[]>([]);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comments, setComments] = useState<Record<string, string>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await api<RatingEligibleBookingDto[]>('/ratings/eligible');
    if (res.ok) setItems(bookingId ? res.data.filter((b) => b.bookingId === bookingId) : res.data);
  }, [bookingId]);
  useEffect(() => {
    if (can('ratings.create')) void load();
  }, [load, can]);

  async function submit(b: RatingEligibleBookingDto, s: RatingEligibleSubjectDto) {
    const k = `${b.bookingId}:${b.raterRole}:${s.subjectType}:${s.subjectId}`;
    const score = scores[k];
    if (!score) return;
    setBusy(k);
    setError(null);
    const res = await api<RatingDto>('/ratings', { method: 'POST', body: { bookingId: b.bookingId, raterRole: b.raterRole, subjectType: s.subjectType, subjectId: s.subjectId, score, ...(comments[k] ? { comment: comments[k] } : {}) } });
    setBusy(null);
    if (!res.ok) setError(res.error);
    await load();
  }

  if (!items.length && !error) return null;
  return (
    <div className="space-y-3">
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      {items.map((b) => (
        <Card key={`${b.bookingId}:${b.raterRole}`} className="border-amber-300/60">
          <CardHeader>
            <CardTitle className="text-base">{t('title', { booking: b.bookingNumber })}</CardTitle>
            <CardDescription>{t('deadline', { date: fmt(locale, b.deadline) })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {b.subjects.map((s) => {
              const k = `${b.bookingId}:${b.raterRole}:${s.subjectType}:${s.subjectId}`;
              return (
                <div key={k} className="flex flex-wrap items-center gap-3">
                  <div className="w-40 text-sm"><span className="text-muted-foreground">{t(`subjects.${s.subjectType}`)}</span><div dir="ltr">{s.label}</div></div>
                  {s.alreadyRated ? (
                    <span className="text-sm text-muted-foreground">{t('rated')}</span>
                  ) : (
                    <>
                      <Stars value={scores[k] ?? 0} onChange={(v) => { setScores({ ...scores, [k]: v }); }} label={s.label} />
                      <Input className="max-w-xs" placeholder={t('comment')} value={comments[k] ?? ''} onChange={(e) => { setComments({ ...comments, [k]: e.target.value }); }} />
                      <Button size="sm" disabled={busy === k || !scores[k]} onClick={() => void submit(b, s)}>{t('submit')}</Button>
                    </>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
