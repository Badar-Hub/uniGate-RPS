'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { CalendarEntryDto, DriverDto, VehicleAssignmentDto, VehicleDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DocumentChecklist } from './document-checklist';
import { APPROVAL_TONE } from './fleet-list';

function isoLocal(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

/** One vehicle: status + dispatchability, its document checklist, calendar blocks, driver assignments. */
export function VehicleDetail({ id, created = false }: { id: string; created?: boolean }) {
  const t = useTranslations('portal.fleet');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { me, can } = useSession();
  const [v, setV] = useState<VehicleDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(created ? t('form.created') : null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<VehicleDto>(`/vehicles/${id}`);
    if (res.ok) setV(res.data);
    else setError(res.error);
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await api<VehicleDto>(`/vehicles/${id}/submit-for-approval`, { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setV(res.data);
    setNotice(t('detail.submitted'));
  }

  if (!v) {
    return error ? (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
      </Alert>
    ) : (
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    );
  }
  const missing = (error?.details as { missing?: string[] } | undefined)?.missing;
  // Documents, calendar and drivers belong to the owner and staff. A customer reaches a booked
  // vehicle through their booking (PARTY scope) and sees only what the booking shows them.
  const manages = can('vehicles.read_any') || me?.profiles.owner?.id === v.ownerProfileId;
  const specs: [string, string | null][] = [
    [t('spec.color'), v.colorCode],
    [
      t('spec.passengerCapacity'),
      v.passengerCapacity !== null ? String(v.passengerCapacity) : null,
    ],
    [t('spec.payloadCapacityKg'), v.payloadCapacityKg],
    [t('spec.cargoVolumeM3'), v.cargoVolumeM3],
    [t('spec.bodyType'), v.bodyType],
    [
      t('spec.features'),
      [
        v.hasRefrigeration ? t('spec.refrigeration') : null,
        v.hasTailLift ? t('spec.tailLift') : null,
      ]
        .filter(Boolean)
        .join(' · ') || null,
    ],
    [t('spec.rating'), v.ratingCount > 0 ? `${v.ratingAvg} (${v.ratingCount})` : null],
    [t('spec.drivers'), v.currentDrivers.map((d) => d.driverName).join(', ') || null],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" dir="ltr">
            {v.plateNumberEn}
          </h1>
          <p className="text-sm text-muted-foreground">
            {[v.make?.name, v.model?.name, v.modelYear].filter(Boolean).join(' · ')} ·{' '}
            {locale === 'ar' ? v.category.nameAr : v.category.nameEn}
          </p>
        </div>
        {manages && (
          <div className="flex items-center gap-2">
            <Badge variant={APPROVAL_TONE[v.approvalStatus] ?? 'outline'}>
              {t(`status.${v.approvalStatus}` as 'status.DRAFT')}
            </Badge>
            <Badge variant="outline">{t(`status.${v.lifecycleStatus}` as 'status.ACTIVE')}</Badge>
            <Badge variant={v.dispatchable.ok ? 'default' : 'outline'}>
              {v.dispatchable.ok ? t('dispatchable') : t('notDispatchable')}
            </Badge>
          </div>
        )}
      </div>

      {notice && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            {errorMessage(tc, error)}
            {missing?.length ? <div className="mt-1 text-xs">{missing.join(', ')}</div> : null}
          </AlertDescription>
        </Alert>
      )}
      {v.approvalStatus === 'REJECTED' && v.rejectionReason && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>
            {t('detail.rejectedReason')}: {v.rejectionReason}
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="p-4">
          <CardTitle className="text-sm">{t('spec.title')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 pt-0 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {specs
            .filter(([, val]) => val)
            .map(([label, val]) => (
              <div key={label}>
                <div className="text-xs text-muted-foreground">{label}</div>
                <div dir="ltr">{val}</div>
              </div>
            ))}
        </CardContent>
      </Card>
      {manages && !v.dispatchable.ok && (
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-sm">{t('detail.reasons')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2 p-4 pt-0">
            {v.dispatchable.reasons.map((r) => (
              <Badge key={r} variant="outline" className="font-mono text-xs">
                {r}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}
      {['DRAFT', 'REJECTED'].includes(v.approvalStatus) && can('vehicles.update') && (
        <Button disabled={busy} onClick={() => void submit()}>
          {busy && <Loader2 className="animate-spin" />}
          {t('detail.submit')}
        </Button>
      )}

      {manages && (
        <Tabs defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents">{t('detail.documents')}</TabsTrigger>
            <TabsTrigger value="calendar">{t('detail.calendar')}</TabsTrigger>
            <TabsTrigger value="drivers">{t('detail.drivers')}</TabsTrigger>
          </TabsList>
          <TabsContent value="documents">
            <DocumentChecklist
              target={{
                kind: 'VEHICLE',
                id: v.id,
                label: v.plateNumberEn,
                transportType: v.category.transportType as 'PASSENGER' | 'GOODS',
              }}
              onChanged={() => void load()}
            />
          </TabsContent>
          <TabsContent value="calendar">
            <CalendarPanel vehicleId={v.id} canManage={can('vehicles.availability.manage')} />
          </TabsContent>
          <TabsContent value="drivers">
            <DriversPanel
              vehicle={v}
              canAssign={can('drivers.assign')}
              onChanged={() => void load()}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function CalendarPanel({ vehicleId, canManage }: { vehicleId: string; canManage: boolean }) {
  const t = useTranslations('portal.fleet.detail');
  const tc = useTranslations('common');
  const [from, setFrom] = useState(isoLocal(new Date()));
  const [to, setTo] = useState(isoLocal(new Date(Date.now() + 30 * 86_400_000)));
  const [entries, setEntries] = useState<CalendarEntryDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [block, setBlock] = useState({ from: '', to: '', notes: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api<CalendarEntryDto[]>(`/vehicles/${vehicleId}/calendar`, {
      query: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    });
    if (res.ok) setEntries(res.data);
    else setError(res.error);
  }, [vehicleId, from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  async function addBlock(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await api<CalendarEntryDto>(`/vehicles/${vehicleId}/calendar/blocks`, {
      method: 'POST',
      body: {
        from: new Date(block.from).toISOString(),
        to: new Date(block.to).toISOString(),
        ...(block.notes ? { notes: block.notes } : {}),
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setBlock({ from: '', to: '', notes: '' });
    await load();
  }

  async function release(entryId: string) {
    const res = await api(`/vehicles/${vehicleId}/calendar/blocks/${entryId}`, {
      method: 'DELETE',
    });
    if (!res.ok) setError(res.error);
    await load();
  }

  const conflicts = (
    error?.details as
      { conflicts?: { period: { from: string; to: string }; entryType: string }[] } | undefined
  )?.conflicts;

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('window')}</CardTitle>
          <div className="flex flex-wrap gap-2 pt-2">
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
              }}
              className="w-auto"
              dir="ltr"
            />
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
              }}
              className="w-auto"
              dir="ltr"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {entries === null && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
          {entries?.length === 0 && (
            <p className="text-sm text-muted-foreground">{t('noEntries')}</p>
          )}
          {entries?.map((e) => (
            <div
              key={e.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <div>
                <Badge
                  variant={
                    e.entryType === 'RESERVATION'
                      ? 'default'
                      : e.entryType === 'MAINTENANCE'
                        ? 'secondary'
                        : 'outline'
                  }
                >
                  {e.entryType}
                </Badge>
                <span className="ms-2" dir="ltr">
                  {new Date(e.period.from).toLocaleString()} →{' '}
                  {new Date(e.period.to).toLocaleString()}
                </span>
                {e.bookingNumber && (
                  <span className="ms-2 text-muted-foreground">{e.bookingNumber}</span>
                )}
                {e.notes && <div className="text-xs text-muted-foreground">{e.notes}</div>}
              </div>
              {canManage && e.entryType === 'OWNER_BLOCK' && (
                <Button size="sm" variant="ghost" onClick={() => void release(e.id)}>
                  {t('release')}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('block')}</CardTitle>
            <CardDescription />
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void addBlock(e)} className="space-y-3">
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="size-4" />
                  <AlertDescription>
                    {errorMessage(tc, error)}
                    {conflicts?.map((c, i) => (
                      <div key={i} className="mt-1 text-xs" dir="ltr">
                        {c.entryType}: {new Date(c.period.from).toLocaleString()} →{' '}
                        {new Date(c.period.to).toLocaleString()}
                      </div>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-1">
                <Label htmlFor="bfrom">{t('blockFrom')}</Label>
                <Input
                  id="bfrom"
                  type="datetime-local"
                  value={block.from}
                  onChange={(e) => {
                    setBlock((b) => ({ ...b, from: e.target.value }));
                  }}
                  required
                  dir="ltr"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bto">{t('blockTo')}</Label>
                <Input
                  id="bto"
                  type="datetime-local"
                  value={block.to}
                  onChange={(e) => {
                    setBlock((b) => ({ ...b, to: e.target.value }));
                  }}
                  required
                  dir="ltr"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="bnotes">{t('blockNotes')}</Label>
                <Input
                  id="bnotes"
                  value={block.notes}
                  onChange={(e) => {
                    setBlock((b) => ({ ...b, notes: e.target.value }));
                  }}
                />
              </div>
              <Button type="submit" size="sm" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {t('addBlock')}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DriversPanel({
  vehicle,
  canAssign,
  onChanged,
}: {
  vehicle: VehicleDto;
  canAssign: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations('portal.fleet.detail');
  const tc = useTranslations('common');
  const [drivers, setDrivers] = useState<DriverDto[]>([]);
  const [history, setHistory] = useState<VehicleAssignmentDto[]>([]);
  const [pick, setPick] = useState('');
  const [primary, setPrimary] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    const [d, h] = await Promise.all([
      api<DriverDto[]>('/drivers', { query: { approvalStatus: 'APPROVED', pageSize: 100 } }),
      api<VehicleAssignmentDto[]>(`/vehicles/${vehicle.id}/drivers`),
    ]);
    if (d.ok) setDrivers(d.data.filter((x) => x.ownerProfileId === vehicle.ownerProfileId));
    if (h.ok) setHistory(h.data);
  }, [vehicle.id, vehicle.ownerProfileId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function assign() {
    setError(null);
    const res = await api(`/vehicles/${vehicle.id}/drivers`, {
      method: 'POST',
      body: { driverProfileId: pick, isPrimary: primary },
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPick('');
    await load();
    onChanged();
  }
  async function unassign(assignmentId: string) {
    setError(null);
    const res = await api(`/vehicles/${vehicle.id}/drivers/${assignmentId}`, { method: 'DELETE' });
    if (!res.ok) setError(res.error);
    await load();
    onChanged();
  }

  const open = history.filter((a) => !a.assignedTo);
  const assignable = drivers.filter((d) => !open.some((a) => a.driverProfileId === d.id));

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('assignmentHistory')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {history.map((a) => (
            <div
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <div>
                <span className="font-medium">{a.driverName}</span>
                {a.isPrimary && (
                  <Badge variant="secondary" className="ms-2">
                    {t('primary')}
                  </Badge>
                )}
                <div className="text-xs text-muted-foreground" dir="ltr">
                  {new Date(a.assignedFrom).toLocaleString()} →{' '}
                  {a.assignedTo ? new Date(a.assignedTo).toLocaleString() : '…'}
                  {a.unassignedReason ? ` · ${a.unassignedReason}` : ''}
                </div>
              </div>
              {canAssign && !a.assignedTo && (
                <Button size="sm" variant="ghost" onClick={() => void unassign(a.id)}>
                  {t('unassign')}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
      {canAssign && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('assign')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
              </Alert>
            )}
            {assignable.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noDrivers')}</p>
            ) : (
              <>
                <Select value={pick} onValueChange={setPick}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {assignable.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.fullNameEn}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={primary}
                    onChange={(e) => {
                      setPrimary(e.target.checked);
                    }}
                  />
                  {t('primary')}
                </label>
                <Button size="sm" disabled={!pick} onClick={() => void assign()}>
                  {t('assign')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
