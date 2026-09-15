'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AdminDashboardDto, AdminDashboardSeriesDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const select = 'flex h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const day = (d: Date) => d.toISOString().slice(0, 10);

/** BRIEF-§24 KPI block (60-second cache) with a per-vertical filter and a bucketed series (api.md §8.29). */
export function AdminDashboardPage() {
  const t = useTranslations('portal.adminDashboard');
  const tc = useTranslations('common');
  const [range, setRange] = useState({ dateFrom: day(new Date(Date.now() - 29 * 86_400_000)), dateTo: day(new Date()), transportType: '', bucket: 'day' });
  const [kpi, setKpi] = useState<AdminDashboardDto | null>(null);
  const [series, setSeries] = useState<AdminDashboardSeriesDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    const q = { dateFrom: range.dateFrom, dateTo: range.dateTo, ...(range.transportType ? { transportType: range.transportType } : {}) };
    const [a, b] = await Promise.all([api<AdminDashboardDto>('/admin/dashboard', { query: q }), api<AdminDashboardSeriesDto>('/admin/dashboard/series', { query: { ...q, bucket: range.bucket } })]);
    if (a.ok) setKpi(a.data);
    else setError(a.error);
    if (b.ok) setSeries(b.data);
  }, [range]);
  useEffect(() => {
    void load();
  }, [load]);

  const cards: { key: keyof AdminDashboardDto; money?: boolean }[] = [
    { key: 'tripRequests' }, { key: 'bids' }, { key: 'bookings' }, { key: 'activeTrips' }, { key: 'completedTrips' }, { key: 'cancelledBookings' },
    { key: 'grossBookingValue', money: true }, { key: 'platformCommission', money: true }, { key: 'pendingSettlements', money: true }, { key: 'openComplaints' },
    { key: 'users' }, { key: 'customers' }, { key: 'owners' }, { key: 'drivers' }, { key: 'vehicles' }, { key: 'activeVehicles' },
  ];
  const max = Math.max(1, ...(series?.points.map((p) => p.bookings) ?? [1]));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="d-from">{t('from')}</Label><Input id="d-from" type="date" value={range.dateFrom} onChange={(e) => { setRange({ ...range, dateFrom: e.target.value }); }} /></div>
          <div className="space-y-1"><Label htmlFor="d-to">{t('to')}</Label><Input id="d-to" type="date" value={range.dateTo} onChange={(e) => { setRange({ ...range, dateTo: e.target.value }); }} /></div>
          <select className={select} value={range.transportType} onChange={(e) => { setRange({ ...range, transportType: e.target.value }); }} aria-label={t('vertical')}>
            <option value="">{t('allVerticals')}</option>
            <option value="PASSENGER">{t('passenger')}</option>
            <option value="GOODS">{t('goods')}</option>
          </select>
          <select className={select} value={range.bucket} onChange={(e) => { setRange({ ...range, bucket: e.target.value }); }} aria-label={t('bucket')}>
            <option value="day">{t('buckets.day')}</option>
            <option value="week">{t('buckets.week')}</option>
            <option value="month">{t('buckets.month')}</option>
          </select>
        </div>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      {!kpi ? (
        <div className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
            <div key={c.key} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{t(`kpi.${c.key}`)}</div>
              <div className="text-xl font-semibold" dir="ltr">{c.money ? `${String(kpi[c.key])} ${kpi.currency}` : String(kpi[c.key])}</div>
            </div>
          ))}
        </div>
      )}
      {kpi && <p className="text-xs text-muted-foreground">{t('computedAt', { at: new Date(kpi.computedAt).toLocaleString() })}</p>}
      {series && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('series')}</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-muted-foreground">
                    <th className="py-1 text-start">{t('bucket')}</th>
                    <th className="py-1 text-start">{t('kpi.bookings')}</th>
                    <th className="py-1 text-end">{t('kpi.tripRequests')}</th>
                    <th className="py-1 text-end">{t('kpi.completedTrips')}</th>
                    <th className="py-1 text-end">{t('kpi.cancelledBookings')}</th>
                    <th className="py-1 text-end">{t('kpi.grossBookingValue')}</th>
                    <th className="py-1 text-end">{t('kpi.platformCommission')}</th>
                  </tr>
                </thead>
                <tbody>
                  {series.points.map((p) => (
                    <tr key={p.bucket} className="border-t">
                      <td className="py-1" dir="ltr">{p.bucket}</td>
                      <td className="py-1"><div className="flex items-center gap-2"><div className="h-2 rounded bg-primary" style={{ width: `${Math.max(2, (p.bookings / max) * 160)}px` }} /><span dir="ltr">{p.bookings}</span></div></td>
                      <td className="py-1 text-end" dir="ltr">{p.tripRequests}</td>
                      <td className="py-1 text-end" dir="ltr">{p.completedTrips}</td>
                      <td className="py-1 text-end" dir="ltr">{p.cancelledBookings}</td>
                      <td className="py-1 text-end" dir="ltr">{p.grossBookingValue}</td>
                      <td className="py-1 text-end" dir="ltr">{p.platformCommission}</td>
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
