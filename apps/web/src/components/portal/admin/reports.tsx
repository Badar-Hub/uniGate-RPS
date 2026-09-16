'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Download, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';
import type { ExportDownloadUrlDto, ExportJobDto, ReportColumnDto, ReportDefinitionDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Row = Record<string, string | number | boolean | null>;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Reports (api.md §8.28): the screen is generated from the registry — pick a code, fill the
 * filters it declares, run inline (paginated) or queue a CSV export and download it through the
 * 120-second signed URL. Owners, customers and SPOs see their own rows; staff see everything.
 */
export function ReportsPage() {
  const t = useTranslations('portal.reports');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useSession();
  const [defs, setDefs] = useState<ReportDefinitionDto[]>([]);
  const [code, setCode] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({ dateFrom: day(new Date(Date.now() - 29 * 86_400_000)), dateTo: day(new Date()) });
  const [columns, setColumns] = useState<ReportColumnDto[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meta, setMeta] = useState({ page: 1, totalItems: 0, totalPages: 1 });
  const [exports, setExports] = useState<ExportJobDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const def = defs.find((d) => d.code === code) ?? null;

  useEffect(() => {
    void api<ReportDefinitionDto[]>('/reports').then((res) => {
      if (res.ok) {
        setDefs(res.data);
        setCode((c) => c || (res.data[0]?.code ?? ''));
      } else setError(res.error);
    });
  }, []);
  const loadExports = useCallback(async () => {
    if (!can('reports.export')) return;
    const res = await api<ExportJobDto[]>('/reports/exports', { query: { pageSize: 20 } });
    if (res.ok) setExports(res.data);
  }, [can]);
  useEffect(() => {
    void loadExports();
  }, [loadExports]);

  function activeFilters(): Record<string, string> {
    if (!def) return {};
    return Object.fromEntries(Object.entries(filters).filter(([k, v]) => def.filters.includes(k) && v !== ''));
  }
  async function run(page = 1) {
    if (!def) return;
    setBusy(true);
    setError(null);
    const res = await api<Row[]>(`/reports/${def.code}`, { query: { page, pageSize: 50, ...activeFilters() } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows(res.data);
    setColumns(Array.isArray(res.meta['columns']) ? (res.meta['columns'] as ReportColumnDto[]) : def.columns);
    setMeta({ page, totalItems: Number(res.meta['totalItems'] ?? 0), totalPages: Number(res.meta['totalPages'] ?? 1) });
  }
  async function queueExport() {
    if (!def) return;
    setBusy(true);
    setError(null);
    const res = await api<ExportJobDto>(`/reports/${def.code}/export`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey() }, body: { format: 'CSV', filters: activeFilters() } });
    setBusy(false);
    if (!res.ok) setError(res.error);
    await loadExports();
  }
  async function download(job: ExportJobDto) {
    const res = await api<ExportDownloadUrlDto>(`/reports/exports/${job.id}/download-url`);
    if (res.ok) window.open(res.data.url, '_blank', 'noopener');
    else setError(res.error);
  }
  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    void run(1);
  };
  const cell = (c: ReportColumnDto, v: string | number | boolean | null) => {
    if (v === null) return '—';
    if (c.type === 'boolean') return v ? tc('yes') : tc('no');
    if (c.type === 'datetime' && typeof v === 'string') return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));
    return String(v);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}{error.details && 'fieldErrors' in error.details ? ` — ${Object.keys(error.details.fieldErrors as Record<string, unknown>).join(', ')}` : ''}</AlertDescription></Alert>
      )}
      <div className="flex flex-wrap gap-2">
        {defs.map((d) => (
          <Button key={d.code} variant={d.code === code ? 'default' : 'outline'} size="sm" onClick={() => { setCode(d.code); setRows(null); }}>
            {locale === 'ar' ? d.nameAr : d.nameEn}{d.financial && <Badge variant="secondary" className="ms-1">{t('financial')}</Badge>}
          </Button>
        ))}
      </div>
      {def && (
        <Card>
          <CardHeader><CardTitle className="text-base">{locale === 'ar' ? def.nameAr : def.nameEn}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{def.descriptionEn}</p>
            <form className="flex flex-wrap items-end gap-2" onSubmit={submit}>
              {def.filters.map((f) => (
                <div key={f} className="space-y-1">
                  <Label htmlFor={`rf-${f}`} dir="ltr">{f}</Label>
                  <Input id={`rf-${f}`} dir="ltr" type={f.startsWith('date') || f === 'asOf' ? 'date' : 'text'} className="w-44" value={filters[f] ?? ''} onChange={(e) => { setFilters({ ...filters, [f]: e.target.value }); }} />
                </div>
              ))}
              <Button type="submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <RefreshCw className="size-4" />}{t('run')}</Button>
              {can('reports.export') && <Button type="button" variant="outline" disabled={busy} onClick={() => void queueExport()}><FileSpreadsheet className="size-4" />{t('exportCsv')}</Button>}
            </form>
            {rows && (
              <>
                <div className="text-xs text-muted-foreground">{t('rows', { n: meta.totalItems })}</div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>{columns.map((c) => <TableHead key={c.key}>{locale === 'ar' ? c.labelAr : c.labelEn}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.length === 0 ? (
                        <TableRow><TableCell colSpan={columns.length} className="py-6 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
                      ) : (
                        rows.map((r, i) => (
                          <TableRow key={i}>{columns.map((c) => <TableCell key={c.key} dir={c.type === 'string' ? undefined : 'ltr'} className={c.type === 'money' || c.type === 'number' ? 'text-end' : ''}>{cell(c, r[c.key] ?? null)}</TableCell>)}</TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                {meta.totalPages > 1 && (
                  <div className="flex items-center gap-2 text-sm">
                    <Button variant="outline" size="sm" disabled={meta.page <= 1 || busy} onClick={() => void run(meta.page - 1)}>{tc('previous')}</Button>
                    <span dir="ltr">{meta.page} / {meta.totalPages}</span>
                    <Button variant="outline" size="sm" disabled={meta.page >= meta.totalPages || busy} onClick={() => void run(meta.page + 1)}>{tc('next')}</Button>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
      {can('reports.export') && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('exports.title')}</CardTitle></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('exports.report')}</TableHead>
                  <TableHead>{t('exports.status')}</TableHead>
                  <TableHead>{t('exports.rows')}</TableHead>
                  <TableHead>{t('exports.requested')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {exports.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">{t('exports.empty')}</TableCell></TableRow>
                ) : (
                  exports.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell dir="ltr" className="font-mono text-xs">{j.reportCode}</TableCell>
                      <TableCell><Badge variant={j.status === 'COMPLETED' ? 'default' : j.status === 'FAILED' ? 'destructive' : 'outline'}>{j.status}</Badge>{j.errorMessage && <span className="ms-2 text-xs text-destructive">{j.errorMessage}</span>}</TableCell>
                      <TableCell dir="ltr">{j.rowCount ?? '—'}</TableCell>
                      <TableCell dir="ltr" className="text-xs">{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(j.createdAt))}</TableCell>
                      <TableCell className="text-end">
                        {j.downloadable ? <Button variant="ghost" size="sm" onClick={() => void download(j)}><Download className="size-4" />{t('exports.download')}</Button> : <Button variant="ghost" size="sm" onClick={() => void loadExports()}><RefreshCw className="size-4" /></Button>}
                      </TableCell>
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
