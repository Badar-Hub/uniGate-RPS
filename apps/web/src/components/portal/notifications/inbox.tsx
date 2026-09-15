'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Check, CheckCheck, Loader2, Trash2 } from 'lucide-react';
import type { NotificationDto, NotificationPreferenceDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { Link } from '@/lib/i18n/routing';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { notificationHref } from './deep-link';

const CHANNELS = ['IN_APP', 'EMAIL', 'SMS', 'PUSH'] as const;
const fmt = (locale: string, iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** The inbox (api.md §8.26): cursor list with category / unread filters, read / read-all / delete, and the per-category channel preferences (locked rows are transactional). */
export function InboxPage() {
  const t = useTranslations('portal.notifications');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPreferenceDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (after: string | null) => {
    const res = await api<NotificationDto[]>('/notifications', { query: { pageSize: 20, ...(category ? { category } : {}), ...(unreadOnly ? { unreadOnly: true } : {}), ...(after ? { cursor: after } : {}) } });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setItems((prev) => (after && prev ? [...prev, ...res.data] : res.data));
    setCursor(typeof res.meta['nextCursor'] === 'string' ? res.meta['nextCursor'] : null);
  }, [category, unreadOnly]);
  useEffect(() => {
    setItems(null);
    void load(null);
  }, [load]);
  useEffect(() => {
    void api<NotificationPreferenceDto[]>('/notifications/preferences').then((res) => {
      if (res.ok) setPrefs(res.data);
    });
  }, []);

  async function act(fn: () => Promise<{ ok: boolean; error?: ApiError }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok && res.error) setError(res.error);
    await load(null);
  }
  async function togglePref(p: NotificationPreferenceDto) {
    const res = await api<NotificationPreferenceDto[]>('/notifications/preferences', { method: 'PUT', body: { preferences: [{ category: p.category, channel: p.channel, isEnabled: !p.isEnabled }] } });
    if (res.ok) setPrefs(res.data);
    else setError(res.error);
  }
  const categories = [...new Set(prefs.map((p) => p.category))];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={category} onChange={(e) => { setCategory(e.target.value); }}>
            <option value="">{t('allCategories')}</option>
            {categories.map((c) => <option key={c} value={c}>{t(`categories.${c}`)}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); }} />{t('unreadOnly')}</label>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void act(() => api('/notifications/read-all', { method: 'POST', body: category ? { category } : {} }))}><CheckCheck className="size-4" />{t('readAll')}</Button>
        </div>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      <Card>
        <CardContent className="divide-y p-0">
          {items === null ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{t('empty')}</div>
          ) : (
            items.map((n) => {
              const href = notificationHref(n);
              return (
                <div key={n.id} className={`flex items-start gap-3 p-4 ${n.readAt ? '' : 'bg-primary/5'}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={n.readAt ? 'text-sm' : 'text-sm font-medium'}>{n.title ?? n.templateCode}</span>
                      <Badge variant="outline">{t(`categories.${n.category}`)}</Badge>
                      <span className="text-xs text-muted-foreground" dir="ltr">{fmt(locale, n.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>
                    {href && <Link href={href} className="mt-1 inline-block text-xs text-primary hover:underline" onClick={() => { if (!n.readAt) void api(`/notifications/${n.id}/read`, { method: 'POST' }); }}>{t('open')}</Link>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {!n.readAt && <Button variant="ghost" size="sm" aria-label={t('markRead')} disabled={busy} onClick={() => void act(() => api(`/notifications/${n.id}/read`, { method: 'POST' }))}><Check className="size-4" /></Button>}
                    <Button variant="ghost" size="sm" aria-label={t('remove')} disabled={busy} onClick={() => void act(() => api(`/notifications/${n.id}`, { method: 'DELETE' }))}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
              );
            })
          )}
          {cursor && (
            <div className="p-3 text-center"><Button variant="outline" size="sm" onClick={() => void load(cursor)}>{t('loadMore')}</Button></div>
          )}
        </CardContent>
      </Card>

      {prefs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('preferences.title')}</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">{t('preferences.hint')}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-xs text-muted-foreground">
                    <th className="py-1 text-start">{t('preferences.category')}</th>
                    {CHANNELS.map((c) => <th key={c} className="py-1 text-center">{t(`channels.${c}`)}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c} className="border-t">
                      <td className="py-2">{t(`categories.${c}`)}{prefs.find((p) => p.category === c)?.isLocked && <span className="ms-2 text-xs text-muted-foreground">{t('preferences.locked')}</span>}</td>
                      {CHANNELS.map((ch) => {
                        const p = prefs.find((x) => x.category === c && x.channel === ch);
                        return (
                          <td key={ch} className="py-2 text-center">
                            {p && <input type="checkbox" aria-label={`${c} ${ch}`} checked={p.isEnabled} disabled={p.isLocked} onChange={() => void togglePref(p)} />}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
