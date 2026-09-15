'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, Play, Trash2, Wrench, XCircle } from 'lucide-react';
import type { CodedLabelDto, MaintenanceDueDto, MaintenanceRecordDto, MaintenanceScheduleDto, VehicleDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const KINDS = ['SCHEDULED', 'UNSCHEDULED', 'REPAIR', 'INSPECTION'] as const;
const select = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const localIso = (v: string) => (v ? new Date(v).toISOString() : '');
const fmt = (locale: string, iso: string | null) => (iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '—');

/**
 * Maintenance (api.md §8.23): records with their calendar hold (create / start / complete /
 * cancel), interval schedules per vehicle and the due panel the reminder job shares.
 */
export function MaintenancePage() {
  const t = useTranslations('portal.maintenance');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { me, can } = useSession();
  const owner = Boolean(me?.profiles.owner);
  const staff = can('maintenance.read_any');
  const [records, setRecords] = useState<MaintenanceRecordDto[] | null>(null);
  const [schedules, setSchedules] = useState<MaintenanceScheduleDto[]>([]);
  const [due, setDue] = useState<MaintenanceDueDto[]>([]);
  const [types, setTypes] = useState<CodedLabelDto[]>([]);
  const [vehicles, setVehicles] = useState<VehicleDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [completing, setCompleting] = useState<MaintenanceRecordDto | null>(null);
  const [form, setForm] = useState({ vehicleId: '', maintenanceServiceTypeId: '', maintenanceKind: 'SCHEDULED' as (typeof KINDS)[number], status: 'PLANNED' as 'PLANNED' | 'IN_PROGRESS', scheduledStartAt: '', scheduledEndAt: '', costAmount: '0.00', vatAmount: '0.00', workshopName: '', description: '' });
  const [sched, setSched] = useState({ vehicleId: '', maintenanceServiceTypeId: '', intervalKm: '', intervalDays: '' });
  const [done, setDone] = useState({ odometerKm: '', costAmount: '', vatAmount: '', notes: '', recordExpense: true });
  const name = (r: { serviceTypeNameEn: string; serviceTypeNameAr: string }) => (locale === 'ar' ? r.serviceTypeNameAr : r.serviceTypeNameEn);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      api<MaintenanceRecordDto[]>('/maintenance/records', { query: { pageSize: 100 } }),
      api<MaintenanceScheduleDto[]>('/maintenance/schedules', { query: { pageSize: 100, isActive: true } }),
      api<MaintenanceDueDto[]>('/maintenance/due'),
    ]);
    if (a.ok) setRecords(a.data);
    else setError(a.error);
    if (b.ok) setSchedules(b.data);
    if (c.ok) setDue(c.data);
  }, []);
  useEffect(() => {
    void load();
    void api<CodedLabelDto[]>('/reference/maintenance-service-types').then((res) => {
      if (res.ok) {
        setTypes(res.data);
        const first = res.data[0]?.id ?? '';
        setForm((f) => ({ ...f, maintenanceServiceTypeId: f.maintenanceServiceTypeId || first }));
        setSched((s) => ({ ...s, maintenanceServiceTypeId: s.maintenanceServiceTypeId || first }));
      }
    });
    if (owner || staff) {
      void api<VehicleDto[]>('/vehicles', { query: { pageSize: 100 } }).then((res) => {
        if (res.ok) {
          setVehicles(res.data);
          const first = res.data[0]?.id ?? '';
          setForm((f) => ({ ...f, vehicleId: f.vehicleId || first }));
          setSched((s) => ({ ...s, vehicleId: s.vehicleId || first }));
        }
      });
    }
  }, [load, owner, staff]);

  async function run(fn: () => Promise<{ ok: boolean; error?: ApiError }>) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok && res.error) setError(res.error);
    await load();
    return res.ok;
  }

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    const ok = await run(() => api<MaintenanceRecordDto>('/maintenance/records', {
      method: 'POST',
      body: {
        vehicleId: form.vehicleId, maintenanceServiceTypeId: form.maintenanceServiceTypeId, maintenanceKind: form.maintenanceKind, status: form.status, scheduledStartAt: localIso(form.scheduledStartAt), scheduledEndAt: localIso(form.scheduledEndAt),
        costAmount: form.costAmount || '0.00', vatAmount: form.vatAmount || '0.00', ...(form.workshopName ? { workshopName: form.workshopName } : {}), ...(form.description ? { description: form.description } : {}),
      },
    }));
    if (ok) setForm((f) => ({ ...f, scheduledStartAt: '', scheduledEndAt: '', costAmount: '0.00', vatAmount: '0.00', workshopName: '', description: '' }));
  }
  async function submitSchedule(e: SyntheticEvent) {
    e.preventDefault();
    const ok = await run(() => api<MaintenanceScheduleDto>('/maintenance/schedules', {
      method: 'POST',
      body: { vehicleId: sched.vehicleId, maintenanceServiceTypeId: sched.maintenanceServiceTypeId, ...(sched.intervalKm ? { intervalKm: Number(sched.intervalKm) } : {}), ...(sched.intervalDays ? { intervalDays: Number(sched.intervalDays) } : {}) },
    }));
    if (ok) setSched((s) => ({ ...s, intervalKm: '', intervalDays: '' }));
  }
  async function complete(e: SyntheticEvent) {
    e.preventDefault();
    if (!completing) return;
    const ok = await run(() => api<MaintenanceRecordDto>(`/maintenance/records/${completing.id}/complete`, {
      method: 'POST',
      body: { ...(done.odometerKm ? { odometerKm: Number(done.odometerKm) } : {}), ...(done.costAmount ? { costAmount: done.costAmount } : {}), ...(done.vatAmount ? { vatAmount: done.vatAmount } : {}), ...(done.notes ? { notes: done.notes } : {}), recordExpense: done.recordExpense },
    }));
    if (ok) {
      setCompleting(null);
      setDone({ odometerKm: '', costAmount: '', vatAmount: '', notes: '', recordExpense: true });
    }
  }
  const status = (s: string) => <Badge variant={s === 'COMPLETED' ? 'default' : s === 'CANCELLED' ? 'secondary' : 'outline'}>{t(`status.${s}`)}</Badge>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}

      {due.length > 0 && (
        <Card className="border-amber-300/60">
          <CardHeader><CardTitle className="text-base">{t('due.title')}</CardTitle></CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            {due.map((d) => (
              <div key={d.scheduleId} className={`rounded-md border p-3 ${d.overdue ? 'border-destructive/50 bg-destructive/5' : ''}`}>
                <div className="flex items-center justify-between text-sm font-medium"><span dir="ltr">{d.vehiclePlate}</span>{d.overdue && <Badge variant="destructive">{t('due.overdue')}</Badge>}</div>
                <div className="text-sm">{name(d)}</div>
                <div className="text-xs text-muted-foreground">
                  {d.daysUntilDue !== null && t('due.inDays', { n: d.daysUntilDue })}
                  {d.daysUntilDue !== null && d.kmUntilDue !== null && ' · '}
                  {d.kmUntilDue !== null && t('due.inKm', { n: d.kmUntilDue })}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {can('maintenance.create') && (owner || staff) && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('record')}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => void submit(e)}>
              <div className="space-y-1">
                <Label htmlFor="mt-vehicle">{t('vehicle')}</Label>
                <select id="mt-vehicle" className={select} value={form.vehicleId} onChange={(e) => { setForm({ ...form, vehicleId: e.target.value }); }}>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumberEn}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mt-type">{t('serviceType')}</Label>
                <select id="mt-type" className={select} value={form.maintenanceServiceTypeId} onChange={(e) => { setForm({ ...form, maintenanceServiceTypeId: e.target.value }); }}>
                  {types.map((c) => <option key={c.id} value={c.id}>{locale === 'ar' ? c.nameAr : c.nameEn}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mt-kind">{t('kind')}</Label>
                <select id="mt-kind" className={select} value={form.maintenanceKind} onChange={(e) => { setForm({ ...form, maintenanceKind: e.target.value as (typeof KINDS)[number] }); }}>
                  {KINDS.map((k) => <option key={k} value={k}>{t(`kinds.${k}`)}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mt-from">{t('from')}</Label>
                <Input id="mt-from" type="datetime-local" required value={form.scheduledStartAt} onChange={(e) => { setForm({ ...form, scheduledStartAt: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mt-to">{t('to')}</Label>
                <Input id="mt-to" type="datetime-local" required value={form.scheduledEndAt} onChange={(e) => { setForm({ ...form, scheduledEndAt: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mt-status">{t('initialStatus')}</Label>
                <select id="mt-status" className={select} value={form.status} onChange={(e) => { setForm({ ...form, status: e.target.value as 'PLANNED' | 'IN_PROGRESS' }); }}>
                  <option value="PLANNED">{t('status.PLANNED')}</option>
                  <option value="IN_PROGRESS">{t('status.IN_PROGRESS')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="mt-cost">{t('cost')}</Label>
                <Input id="mt-cost" dir="ltr" value={form.costAmount} onChange={(e) => { setForm({ ...form, costAmount: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mt-vat">{t('vat')}</Label>
                <Input id="mt-vat" dir="ltr" value={form.vatAmount} onChange={(e) => { setForm({ ...form, vatAmount: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mt-workshop">{t('workshop')}</Label>
                <Input id="mt-workshop" value={form.workshopName} onChange={(e) => { setForm({ ...form, workshopName: e.target.value }); }} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="mt-desc">{t('description')}</Label>
                <Input id="mt-desc" value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); }} />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || !form.vehicleId || !form.maintenanceServiceTypeId || !form.scheduledStartAt || !form.scheduledEndAt}>
                  {busy ? <Loader2 className="animate-spin" /> : <Wrench className="size-4" />}
                  {t('save')}
                </Button>
              </div>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">{t('holdHint')}</p>
          </CardContent>
        </Card>
      )}

      {completing && (
        <Card className="border-primary/40">
          <CardHeader><CardTitle className="text-base">{t('complete.title', { plate: completing.vehiclePlate, type: name(completing) })}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => void complete(e)}>
              <div className="space-y-1">
                <Label htmlFor="mc-odo">{t('complete.odometer')}</Label>
                <Input id="mc-odo" dir="ltr" type="number" min={0} value={done.odometerKm} onChange={(e) => { setDone({ ...done, odometerKm: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mc-cost">{t('cost')}</Label>
                <Input id="mc-cost" dir="ltr" placeholder={completing.costAmount} value={done.costAmount} onChange={(e) => { setDone({ ...done, costAmount: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mc-vat">{t('vat')}</Label>
                <Input id="mc-vat" dir="ltr" placeholder={completing.vatAmount} value={done.vatAmount} onChange={(e) => { setDone({ ...done, vatAmount: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="mc-notes">{t('complete.notes')}</Label>
                <Input id="mc-notes" value={done.notes} onChange={(e) => { setDone({ ...done, notes: e.target.value }); }} />
              </div>
              <div className="flex items-center gap-3 sm:col-span-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={done.recordExpense} onChange={(e) => { setDone({ ...done, recordExpense: e.target.checked }); }} />
                  {t('complete.recordExpense')}
                </label>
                <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}{t('complete.confirm')}</Button>
                <Button type="button" variant="ghost" onClick={() => { setCompleting(null); }}>{tc('cancel')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('vehicle')}</TableHead>
                <TableHead>{t('serviceType')}</TableHead>
                <TableHead>{t('window')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
                <TableHead>{t('total')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {records === null ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : records.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                records.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell dir="ltr">{r.vehiclePlate}</TableCell>
                    <TableCell>
                      <div>{name(r)}</div>
                      <div className="text-xs text-muted-foreground">{t(`kinds.${r.maintenanceKind}`)}{r.workshopName ? ` · ${r.workshopName}` : ''}</div>
                    </TableCell>
                    <TableCell className="text-sm"><span dir="ltr">{fmt(locale, r.scheduledStartAt)}</span> → <span dir="ltr">{fmt(locale, r.scheduledEndAt)}</span></TableCell>
                    <TableCell>{status(r.status)}</TableCell>
                    <TableCell dir="ltr">{r.totalAmount} {r.currency}</TableCell>
                    <TableCell className="text-end">
                      {can('maintenance.update') && (r.status === 'PLANNED' || r.status === 'IN_PROGRESS') && (
                        <div className="flex justify-end gap-1">
                          {r.status === 'PLANNED' && <Button variant="ghost" size="sm" aria-label={t('start')} disabled={busy} onClick={() => void run(() => api(`/maintenance/records/${r.id}/start`, { method: 'POST' }))}><Play className="size-4" /></Button>}
                          <Button variant="ghost" size="sm" aria-label={t('complete.confirm')} disabled={busy} onClick={() => { setCompleting(r); setDone({ odometerKm: '', costAmount: '', vatAmount: '', notes: '', recordExpense: true }); }}><CheckCircle2 className="size-4" /></Button>
                          <Button variant="ghost" size="sm" aria-label={t('cancel')} disabled={busy} onClick={() => { const reason = window.prompt(t('cancelReason')); if (reason && reason.length >= 3) void run(() => api(`/maintenance/records/${r.id}/cancel`, { method: 'POST', body: { reason } })); }}><XCircle className="size-4" /></Button>
                          {staff && r.status === 'PLANNED' && can('maintenance.delete') && <Button variant="ghost" size="sm" aria-label={t('remove')} disabled={busy} onClick={() => void run(() => api(`/maintenance/records/${r.id}`, { method: 'DELETE' }))}><Trash2 className="size-4" /></Button>}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">{t('schedules.title')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {can('maintenance.create') && (owner || staff) && (
            <form className="grid gap-3 sm:grid-cols-5" onSubmit={(e) => void submitSchedule(e)}>
              <div className="space-y-1">
                <Label htmlFor="ms-vehicle">{t('vehicle')}</Label>
                <select id="ms-vehicle" className={select} value={sched.vehicleId} onChange={(e) => { setSched({ ...sched, vehicleId: e.target.value }); }}>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plateNumberEn}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ms-type">{t('serviceType')}</Label>
                <select id="ms-type" className={select} value={sched.maintenanceServiceTypeId} onChange={(e) => { setSched({ ...sched, maintenanceServiceTypeId: e.target.value }); }}>
                  {types.map((c) => <option key={c.id} value={c.id}>{locale === 'ar' ? c.nameAr : c.nameEn}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ms-km">{t('schedules.everyKm')}</Label>
                <Input id="ms-km" dir="ltr" type="number" min={100} value={sched.intervalKm} onChange={(e) => { setSched({ ...sched, intervalKm: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ms-days">{t('schedules.everyDays')}</Label>
                <Input id="ms-days" dir="ltr" type="number" min={1} value={sched.intervalDays} onChange={(e) => { setSched({ ...sched, intervalDays: e.target.value }); }} />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || !sched.vehicleId || !sched.maintenanceServiceTypeId || (!sched.intervalKm && !sched.intervalDays)}>{t('schedules.add')}</Button>
              </div>
            </form>
          )}
          {schedules.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('schedules.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('vehicle')}</TableHead>
                  <TableHead>{t('serviceType')}</TableHead>
                  <TableHead>{t('schedules.interval')}</TableHead>
                  <TableHead>{t('schedules.nextDue')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {schedules.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell dir="ltr">{s.vehiclePlate}</TableCell>
                    <TableCell>{name(s)}</TableCell>
                    <TableCell className="text-sm">{[s.intervalKm ? t('schedules.km', { n: s.intervalKm }) : null, s.intervalDays ? t('schedules.days', { n: s.intervalDays }) : null].filter(Boolean).join(' / ')}</TableCell>
                    <TableCell className="text-sm">{[s.nextDueOdometerKm !== null ? `${s.nextDueOdometerKm} km` : null, s.nextDueAt ? fmt(locale, s.nextDueAt) : null].filter(Boolean).join(' · ') || '—'}</TableCell>
                    <TableCell className="text-end">
                      {can('maintenance.delete') && <Button variant="ghost" size="sm" aria-label={t('remove')} disabled={busy} onClick={() => void run(() => api(`/maintenance/schedules/${s.id}`, { method: 'DELETE' }))}><Trash2 className="size-4" /></Button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
