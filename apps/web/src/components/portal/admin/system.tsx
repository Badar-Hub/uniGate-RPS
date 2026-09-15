'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import type { OutboxEventDto, PaymentWebhookEventDto, SystemHealthDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const fmt = (locale: string, iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(iso)) : '—');

/** System (api.md §8.29): deep health, queue depths, the payment-incident tool (webhook replay) and the outbox retry. */
export function AdminSystemPage() {
  const t = useTranslations('portal.adminSystem');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useSession();
  const [health, setHealth] = useState<SystemHealthDto | null>(null);
  const [webhooks, setWebhooks] = useState<PaymentWebhookEventDto[]>([]);
  const [outbox, setOutbox] = useState<OutboxEventDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [h, w, o] = await Promise.all([
      can('system.health.read') ? api<SystemHealthDto>('/admin/system/health') : null,
      can('payments.manage') ? api<PaymentWebhookEventDto[]>('/admin/webhooks/payments', { query: { pageSize: 25 } }) : null,
      can('platform.jobs.manage') ? api<OutboxEventDto[]>('/admin/outbox', { query: { pageSize: 25, status: 'FAILED' } }) : null,
    ]);
    if (h) {
      if (h.ok) setHealth(h.data);
      else setError(h.error);
    }
    if (w?.ok) setWebhooks(w.data);
    if (o?.ok) setOutbox(o.data);
  }, [can]);
  useEffect(() => {
    void load();
  }, [load]);

  async function replay(id: string) {
    setBusy(id);
    setError(null);
    const res = await api(`/admin/webhooks/payments/${id}/replay`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) setError(res.error);
    await load();
  }
  async function retry(id: string) {
    setBusy(id);
    setError(null);
    const res = await api(`/admin/outbox/${id}/retry`, { method: 'POST' });
    setBusy(null);
    if (!res.ok) setError(res.error);
    await load();
  }
  const statusTone = (s: string): 'default' | 'secondary' | 'destructive' | 'outline' => (s === 'ok' ? 'default' : s === 'degraded' ? 'secondary' : 'destructive');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" />{tc('retry')}</Button>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      {can('system.health.read') && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base">{t('health')}{health && <Badge variant={statusTone(health.status)}>{health.status}</Badge>}</CardTitle></CardHeader>
          <CardContent>
            {!health ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                {(['database', 'redis', 'storage'] as const).map((k) => (
                  <div key={k} className="rounded-md border p-3">
                    <div className="flex items-center justify-between text-sm"><span>{t(`checks.${k}`)}</span><Badge variant={health.checks[k].ok ? 'default' : 'destructive'}>{health.checks[k].ok ? t('up') : t('down')}</Badge></div>
                    <div className="text-xs text-muted-foreground" dir="ltr">{health.checks[k].latencyMs} ms{health.checks[k].error ? ` · ${health.checks[k].error}` : ''}</div>
                  </div>
                ))}
                <div className="rounded-md border p-3 text-sm md:col-span-3">
                  <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                    <div><span className="text-muted-foreground">{t('version')}:</span> <span dir="ltr">{health.version}</span></div>
                    <div><span className="text-muted-foreground">{t('environment')}:</span> <span dir="ltr">{health.environment}</span></div>
                    <div><span className="text-muted-foreground">{t('migration')}:</span> <span dir="ltr">{health.migration ?? '—'}</span></div>
                    <div><span className="text-muted-foreground">{t('oldestWebhook')}:</span> <span dir="ltr">{fmt(locale, health.oldestUnprocessedWebhookAt)}</span></div>
                    <div><span className="text-muted-foreground">{t('outbox')}:</span> <span dir="ltr">{health.outbox.pending} pending · {health.outbox.failed} failed</span></div>
                    {Object.entries(health.providers).map(([k, v]) => <div key={k}><span className="text-muted-foreground" dir="ltr">{k}:</span> <span dir="ltr">{v}</span></div>)}
                  </div>
                </div>
                {health.queues.map((q) => (
                  <div key={q.name} className="rounded-md border p-3 text-sm">
                    <div className="flex items-center justify-between"><span dir="ltr">{q.name}</span>{!q.reachable && <Badge variant="destructive">{t('down')}</Badge>}</div>
                    <div className="text-xs text-muted-foreground" dir="ltr">waiting {q.waiting} · active {q.active} · delayed {q.delayed} · failed {q.failed}</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {can('payments.manage') && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('webhooks')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>{t('received')}</TableHead><TableHead>{t('provider')}</TableHead><TableHead>{t('event')}</TableHead><TableHead>{t('signature')}</TableHead><TableHead>{t('processing')}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {webhooks.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
                ) : (
                  webhooks.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="text-xs" dir="ltr">{fmt(locale, w.receivedAt)}</TableCell>
                      <TableCell dir="ltr">{w.providerCode}</TableCell>
                      <TableCell dir="ltr" className="font-mono text-xs">{w.eventType}</TableCell>
                      <TableCell><Badge variant={w.signatureValid ? 'outline' : 'destructive'}>{w.signatureValid ? t('valid') : t('invalid')}</Badge></TableCell>
                      <TableCell><Badge variant={w.processingStatus === 'PROCESSED' ? 'default' : w.processingStatus === 'FAILED' ? 'destructive' : 'secondary'}>{w.processingStatus}</Badge>{w.lastError && <span className="ms-2 text-xs text-destructive">{w.lastError}</span>}</TableCell>
                      <TableCell className="text-end">{w.signatureValid && <Button variant="ghost" size="sm" disabled={busy === w.id} onClick={() => void replay(w.id)}><RotateCcw className="size-4" />{t('replay')}</Button>}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      {can('platform.jobs.manage') && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('failedOutbox')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>{t('created')}</TableHead><TableHead>{t('event')}</TableHead><TableHead>{t('attempts')}</TableHead><TableHead>{t('lastError')}</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {outbox.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">{t('noFailed')}</TableCell></TableRow>
                ) : (
                  outbox.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="text-xs" dir="ltr">{fmt(locale, o.createdAt)}</TableCell>
                      <TableCell dir="ltr" className="font-mono text-xs">{o.eventType}</TableCell>
                      <TableCell dir="ltr">{o.attemptCount}</TableCell>
                      <TableCell className="text-xs text-destructive">{o.lastError}</TableCell>
                      <TableCell className="text-end"><Button variant="ghost" size="sm" disabled={busy === o.id} onClick={() => void retry(o.id)}><RotateCcw className="size-4" />{t('retryRow')}</Button></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
