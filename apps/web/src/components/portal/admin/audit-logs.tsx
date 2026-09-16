'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Download, History, Loader2 } from 'lucide-react';
import type { AuditLogDto, ExportJobDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const select = 'flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const fmt = (locale: string, iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(iso));
const tone = (s: string): 'default' | 'secondary' | 'destructive' | 'outline' => (s === 'SECURITY' ? 'destructive' : s === 'WARNING' ? 'secondary' : s === 'NOTICE' ? 'default' : 'outline');

/** Audit explorer (api.md §8.30): cursor list with filters, the entity history drill-down, and a bounded CSV export. Reading this screen is itself audited. */
export function AdminAuditLogsPage() {
  const t = useTranslations('portal.adminAudit');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useSession();
  const [filter, setFilter] = useState({ action: '', entityType: '', entityId: '', severity: '', dateFrom: '', dateTo: '' });
  const [applied, setApplied] = useState(filter);
  const [rows, setRows] = useState<AuditLogDto[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<AuditLogDto | null>(null);
  const [history, setHistory] = useState<AuditLogDto[] | null>(null);
  const [exported, setExported] = useState<ExportJobDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const query = useCallback((after: string | null) => ({
    pageSize: 25, ...(applied.action ? { action: applied.action } : {}), ...(applied.entityType ? { entityType: applied.entityType } : {}), ...(applied.entityId ? { entityId: applied.entityId } : {}), ...(applied.severity ? { severity: applied.severity } : {}),
    ...(applied.dateFrom ? { dateFrom: new Date(applied.dateFrom).toISOString() } : {}), ...(applied.dateTo ? { dateTo: new Date(`${applied.dateTo}T23:59:59.999Z`).toISOString() } : {}), ...(after ? { cursor: after } : {}),
  }), [applied]);
  const load = useCallback(async (after: string | null) => {
    const res = await api<AuditLogDto[]>('/audit-logs', { query: query(after) });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows((prev) => (after && prev ? [...prev, ...res.data] : res.data));
    setCursor(typeof res.meta['nextCursor'] === 'string' ? res.meta['nextCursor'] : null);
  }, [query]);
  useEffect(() => {
    setRows(null);
    void load(null);
  }, [load]);

  async function drill(r: AuditLogDto) {
    setOpen(r);
    setHistory(null);
    const res = await api<AuditLogDto[]>(`/audit-logs/entities/${r.entityType}/${r.entityId}`);
    if (res.ok) setHistory(res.data);
    else setError(res.error);
  }
  async function exportCsv() {
    if (!applied.dateFrom || !applied.dateTo) {
      setError({ status: 422, code: 'VALIDATION_FAILED', message: 'date range required' });
      return;
    }
    const res = await api<ExportJobDto>('/audit-logs/export', { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: { dateFrom: applied.dateFrom, dateTo: applied.dateTo, ...(applied.action ? { action: applied.action } : {}), ...(applied.entityType ? { entityType: applied.entityType } : {}), ...(applied.severity ? { severity: applied.severity } : {}) } });
    if (res.ok) setExported(res.data);
    else setError(res.error);
  }
  const apply = (e: SyntheticEvent) => {
    e.preventDefault();
    setApplied(filter);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      {exported && (
        <Alert><Download className="size-4" /><AlertDescription>{t('exportQueued', { id: exported.id })}</AlertDescription></Alert>
      )}
      <form className="grid gap-2 sm:grid-cols-3 lg:grid-cols-7" onSubmit={apply}>
        <div className="space-y-1"><Label htmlFor="al-action">{t('action')}</Label><Input id="al-action" dir="ltr" placeholder="booking." value={filter.action} onChange={(e) => { setFilter({ ...filter, action: e.target.value }); }} /></div>
        <div className="space-y-1"><Label htmlFor="al-type">{t('entityType')}</Label><Input id="al-type" dir="ltr" placeholder="vehicle" value={filter.entityType} onChange={(e) => { setFilter({ ...filter, entityType: e.target.value }); }} /></div>
        <div className="space-y-1"><Label htmlFor="al-id">{t('entityId')}</Label><Input id="al-id" dir="ltr" value={filter.entityId} onChange={(e) => { setFilter({ ...filter, entityId: e.target.value }); }} /></div>
        <div className="space-y-1"><Label htmlFor="al-sev">{t('severity')}</Label>
          <select id="al-sev" className={select} value={filter.severity} onChange={(e) => { setFilter({ ...filter, severity: e.target.value }); }}>
            <option value="">{t('any')}</option>
            {['INFO', 'NOTICE', 'WARNING', 'SECURITY'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="space-y-1"><Label htmlFor="al-from">{t('from')}</Label><Input id="al-from" type="date" value={filter.dateFrom} onChange={(e) => { setFilter({ ...filter, dateFrom: e.target.value }); }} /></div>
        <div className="space-y-1"><Label htmlFor="al-to">{t('to')}</Label><Input id="al-to" type="date" value={filter.dateTo} onChange={(e) => { setFilter({ ...filter, dateTo: e.target.value }); }} /></div>
        <div className="flex items-end gap-2">
          <Button type="submit">{t('apply')}</Button>
          {can('reports.export') && <Button type="button" variant="outline" onClick={() => void exportCsv()}><Download className="size-4" />{t('export')}</Button>}
        </div>
      </form>
      <Card>
        <CardContent className="divide-y p-0">
          {rows === null ? (
            <div className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">{t('empty')}</div>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <span className="w-40 text-xs text-muted-foreground" dir="ltr">{fmt(locale, r.occurredAt)}</span>
                <Badge variant={tone(r.severity)}>{r.severity}</Badge>
                <span className="font-mono text-xs" dir="ltr">{r.action}</span>
                <span className="text-xs text-muted-foreground" dir="ltr">{r.entityType}/{r.entityId.slice(0, 8)}…</span>
                <span className="text-xs">{r.actorName ?? r.actorType}</span>
                {r.changedFields.length > 0 && <span className="text-xs text-muted-foreground" dir="ltr">{r.changedFields.join(', ')}</span>}
                <Button variant="ghost" size="sm" className="ms-auto" onClick={() => void drill(r)}><History className="size-4" />{t('history')}</Button>
              </div>
            ))
          )}
          {cursor && <div className="p-3 text-center"><Button variant="outline" size="sm" onClick={() => void load(cursor)}>{t('loadMore')}</Button></div>}
        </CardContent>
      </Card>
      {open && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle className="text-base"><span dir="ltr">{open.entityType} / {open.entityId}</span></CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {history === null ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              history.map((h) => (
                <div key={h.id} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2"><span dir="ltr">{fmt(locale, h.occurredAt)}</span><Badge variant={tone(h.severity)}>{h.severity}</Badge><span className="font-mono" dir="ltr">{h.action}</span><span>{h.actorName ?? h.actorType}</span>{h.ipAddress && <span dir="ltr" className="text-muted-foreground">{h.ipAddress}</span>}</div>
                  {(h.beforeValue ?? h.afterValue) && (
                    <div className="mt-1 grid gap-2 md:grid-cols-2">
                      <pre className="overflow-x-auto rounded bg-muted/40 p-2" dir="ltr">{JSON.stringify(h.beforeValue ?? {}, null, 1)}</pre>
                      <pre className="overflow-x-auto rounded bg-muted/40 p-2" dir="ltr">{JSON.stringify(h.afterValue ?? {}, null, 1)}</pre>
                    </div>
                  )}
                </div>
              ))
            )}
            <Button variant="ghost" size="sm" onClick={() => { setOpen(null); }}>{tc('cancel')}</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
