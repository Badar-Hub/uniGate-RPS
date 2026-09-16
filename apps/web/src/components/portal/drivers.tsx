'use client';

import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, Plus } from 'lucide-react';
import type { DocumentDto, DownloadUrlDto, DriverDto, OwnerDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage, fieldErrors, unmappedFieldErrors } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DocumentChecklist } from './document-checklist';

const select =
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const STATUSES = [
  'DRAFT',
  'DOCUMENTS_SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
] as const;
const LICENCE_CATEGORIES = ['PRIVATE', 'PUBLIC', 'HEAVY', 'BUS', 'MOTORCYCLE'] as const;
const APPROVAL_TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  APPROVED: 'default',
  UNDER_REVIEW: 'secondary',
  DOCUMENTS_SUBMITTED: 'secondary',
  REJECTED: 'destructive',
  SUSPENDED: 'destructive',
};

function Field({
  id,
  label,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Drivers (api.md §8.6): a vendor registers drivers under their own profile, staff register on
 * behalf of a vendor or the UniGate fleet. A driver is DRAFT until the licence, TGA card(s) for the
 * applied verticals and photo are uploaded and verified; staff then approve. Approved drivers are
 * assigned to vehicles from the vehicle page and sign in to the driver app with their phone.
 */
export function DriversPage() {
  const { me, can } = useSession();
  const t = useTranslations('portal.drivers');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<DriverDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<DriverDto | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const res = await api<DriverDto[]>('/drivers', {
      query: { pageSize: 100, ...(status ? { approvalStatus: status } : {}) },
    });
    if (res.ok) setRows(res.data);
    else {
      setRows([]);
      setError(res.error);
    }
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  const fmtDate = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso)) : '—';
  const name = (d: DriverDto) => (locale === 'ar' ? d.fullNameAr : null) ?? d.fullNameEn;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="flex items-end gap-2">
          <select
            className={select}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
            }}
            aria-label={t('status')}
          >
            <option value="">{t('any')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
          {can('drivers.create') && (
            <Button
              onClick={() => {
                setAdding(true);
              }}
            >
              <Plus className="size-4" />
              {t('add')}
            </Button>
          )}
        </div>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('driver')}</TableHead>
                <TableHead>{t('licence')}</TableHead>
                <TableHead>{t('verticals')}</TableHead>
                <TableHead>{t('approval')}</TableHead>
                <TableHead>{t('availability')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="inline size-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="font-medium">{name(d)}</div>
                      <div className="text-xs text-muted-foreground" dir="ltr">
                        {d.phoneE164 ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell dir="ltr" className="text-sm">
                      {d.licenseCategories.join(', ')}
                      <div className="text-xs text-muted-foreground">
                        {t('expires', { date: fmtDate(d.licenseExpiryDate) })}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {d.verticals
                        .map(
                          (v) =>
                            `${t(`vertical.${v.transportType}` as 'vertical.PASSENGER')} · ${t(`verticalStatus.${v.status}` as 'verticalStatus.NOT_APPLIED')}`,
                        )
                        .join(' / ') || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={APPROVAL_TONE[d.approvalStatus] ?? 'outline'}>
                        {t(`statuses.${d.approvalStatus}` as 'statuses.DRAFT')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {t(`availabilities.${d.availabilityStatus}` as 'availabilities.OFF_DUTY')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelected(d);
                        }}
                      >
                        {t('open')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {adding && (
        <AddDriverDialog
          onBehalf={!me?.profiles.owner && can('owners.read')}
          onClose={() => {
            setAdding(false);
          }}
          onCreated={(d) => {
            setAdding(false);
            setNotice(t('created', { name: d.fullNameEn }));
            void load();
            setSelected(d);
          }}
        />
      )}
      {selected && (
        <DriverDialog
          driver={selected}
          canEdit={can('drivers.update')}
          canApprove={can('drivers.approve')}
          canVerifyDocs={can('documents.verify')}
          onClose={() => {
            setSelected(null);
            void load();
          }}
        />
      )}
    </div>
  );
}

function AddDriverDialog({
  onBehalf,
  onClose,
  onCreated,
}: {
  onBehalf: boolean;
  onClose: () => void;
  onCreated: (d: DriverDto) => void;
}) {
  const t = useTranslations('portal.drivers.form');
  const tv = useTranslations('portal.drivers.vertical');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [owners, setOwners] = useState<OwnerDto[]>([]);
  const [form, setForm] = useState({
    ownerProfileId: '',
    fullNameEn: '',
    fullNameAr: '',
    phoneE164: '',
    preferredLocale: 'ar',
    idType: 'NATIONAL_ID',
    nationalId: '',
    dateOfBirth: '',
    licenseNumber: '',
    licenseExpiryDate: '',
    licenseCategories: ['PRIVATE'] as string[],
    transportTypes: ['PASSENGER'] as string[],
    emergencyContactName: '',
    emergencyContactPhone: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const fe = fieldErrors(error);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const toggle = (k: 'licenseCategories' | 'transportTypes', v: string) => {
    setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  };

  useEffect(() => {
    if (!onBehalf) return;
    void api<OwnerDto[]>('/owners', {
      query: { pageSize: 100, onboardingStatus: 'APPROVED' },
    }).then((r) => {
      if (!r.ok) return;
      const sorted = [...r.data].sort(
        (a, b) => Number(b.isPlatformFleet) - Number(a.isPlatformFleet),
      );
      setOwners(sorted);
      const platform = sorted.find((o) => o.isPlatformFleet);
      if (platform) setForm((f) => ({ ...f, ownerProfileId: platform.id }));
    });
  }, [onBehalf]);

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      ...(onBehalf && form.ownerProfileId ? { ownerProfileId: form.ownerProfileId } : {}),
      fullNameEn: form.fullNameEn.trim(),
      ...(form.fullNameAr.trim() ? { fullNameAr: form.fullNameAr.trim() } : {}),
      phoneE164: form.phoneE164.trim(),
      preferredLocale: form.preferredLocale,
      idType: form.idType,
      nationalId: form.nationalId.trim(),
      ...(form.dateOfBirth ? { dateOfBirth: form.dateOfBirth } : {}),
      licenseNumber: form.licenseNumber.trim().toUpperCase(),
      licenseExpiryDate: form.licenseExpiryDate,
      licenseCategories: form.licenseCategories,
      transportTypes: form.transportTypes,
      ...(form.emergencyContactName.trim()
        ? { emergencyContactName: form.emergencyContactName.trim() }
        : {}),
      ...(form.emergencyContactPhone.trim()
        ? { emergencyContactPhone: form.emergencyContactPhone.trim() }
        : {}),
    };
    void api<DriverDto>('/drivers', {
      method: 'POST',
      body,
      headers: { 'Idempotency-Key': idempotencyKey() },
    }).then((res) => {
      setBusy(false);
      if (res.ok) onCreated(res.data);
      else setError(res.error);
    });
  };
  const known = [...Object.keys(form)];
  const unmapped = unmappedFieldErrors(error, known);

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          {error && (
            <Alert variant="destructive" className="sm:col-span-2">
              <AlertCircle className="size-4" />
              <AlertDescription>
                {errorMessage(tc, error)}
                {unmapped ? ` — ${unmapped}` : ''}
              </AlertDescription>
            </Alert>
          )}
          {onBehalf && (
            <Field
              id="ownerProfileId"
              label={t('owner')}
              error={fe['ownerProfileId']}
              className="sm:col-span-2"
            >
              <select
                id="ownerProfileId"
                className={select}
                value={form.ownerProfileId}
                onChange={(e) => {
                  set('ownerProfileId')(e.target.value);
                }}
                required
              >
                <option value="">—</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {(locale === 'ar' ? o.businessNameAr : o.businessNameEn) ??
                      o.businessNameEn ??
                      o.id.slice(0, 8)}
                    {o.isPlatformFleet ? ' · UniGate' : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="fullNameEn" label={t('fullNameEn')} error={fe['fullNameEn']}>
            <Input
              id="fullNameEn"
              required
              value={form.fullNameEn}
              onChange={(e) => {
                set('fullNameEn')(e.target.value);
              }}
            />
          </Field>
          <Field id="fullNameAr" label={t('fullNameAr')} error={fe['fullNameAr']}>
            <Input
              id="fullNameAr"
              dir="rtl"
              value={form.fullNameAr}
              onChange={(e) => {
                set('fullNameAr')(e.target.value);
              }}
            />
          </Field>
          <Field id="phoneE164" label={t('phone')} error={fe['phoneE164']}>
            <Input
              id="phoneE164"
              required
              dir="ltr"
              placeholder="+9665XXXXXXXX"
              value={form.phoneE164}
              onChange={(e) => {
                set('phoneE164')(e.target.value);
              }}
            />
          </Field>
          <Field id="preferredLocale" label={t('locale')} error={fe['preferredLocale']}>
            <select
              id="preferredLocale"
              className={select}
              value={form.preferredLocale}
              onChange={(e) => {
                set('preferredLocale')(e.target.value);
              }}
            >
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field id="idType" label={t('idType')} error={fe['idType']}>
            <select
              id="idType"
              className={select}
              value={form.idType}
              onChange={(e) => {
                set('idType')(e.target.value);
              }}
            >
              <option value="NATIONAL_ID">{t('idTypes.NATIONAL_ID')}</option>
              <option value="IQAMA">{t('idTypes.IQAMA')}</option>
            </select>
          </Field>
          <Field id="nationalId" label={t('nationalId')} error={fe['nationalId']}>
            <Input
              id="nationalId"
              required
              dir="ltr"
              inputMode="numeric"
              maxLength={10}
              placeholder="1XXXXXXXXX / 2XXXXXXXXX"
              value={form.nationalId}
              onChange={(e) => {
                set('nationalId')(e.target.value);
              }}
            />
          </Field>
          <Field id="dateOfBirth" label={t('dateOfBirth')} error={fe['dateOfBirth']}>
            <Input
              id="dateOfBirth"
              type="date"
              dir="ltr"
              value={form.dateOfBirth}
              onChange={(e) => {
                set('dateOfBirth')(e.target.value);
              }}
            />
          </Field>
          <Field id="licenseNumber" label={t('licenseNumber')} error={fe['licenseNumber']}>
            <Input
              id="licenseNumber"
              required
              dir="ltr"
              value={form.licenseNumber}
              onChange={(e) => {
                set('licenseNumber')(e.target.value);
              }}
            />
          </Field>
          <Field
            id="licenseExpiryDate"
            label={t('licenseExpiryDate')}
            error={fe['licenseExpiryDate']}
          >
            <Input
              id="licenseExpiryDate"
              type="date"
              required
              dir="ltr"
              min={new Date().toISOString().slice(0, 10)}
              value={form.licenseExpiryDate}
              onChange={(e) => {
                set('licenseExpiryDate')(e.target.value);
              }}
            />
          </Field>
          <Field
            id="licenseCategories"
            label={t('licenseCategories')}
            error={fe['licenseCategories']}
          >
            <div id="licenseCategories" className="flex flex-wrap gap-2 pt-1">
              {LICENCE_CATEGORIES.map((c) => (
                <label key={c} className="inline-flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.licenseCategories.includes(c)}
                    onChange={() => {
                      toggle('licenseCategories', c);
                    }}
                  />
                  {t(`licenceCategories.${c}`)}
                </label>
              ))}
            </div>
          </Field>
          <Field id="transportTypes" label={t('transportTypes')} error={fe['transportTypes']}>
            <div id="transportTypes" className="flex flex-wrap gap-3 pt-1">
              {(['PASSENGER', 'GOODS'] as const).map((v) => (
                <label key={v} className="inline-flex items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={form.transportTypes.includes(v)}
                    onChange={() => {
                      toggle('transportTypes', v);
                    }}
                  />
                  {tv(v)}
                </label>
              ))}
            </div>
          </Field>
          <Field
            id="emergencyContactName"
            label={t('emergencyContactName')}
            error={fe['emergencyContactName']}
          >
            <Input
              id="emergencyContactName"
              value={form.emergencyContactName}
              onChange={(e) => {
                set('emergencyContactName')(e.target.value);
              }}
            />
          </Field>
          <Field
            id="emergencyContactPhone"
            label={t('emergencyContactPhone')}
            error={fe['emergencyContactPhone']}
          >
            <Input
              id="emergencyContactPhone"
              dir="ltr"
              placeholder="+9665XXXXXXXX"
              value={form.emergencyContactPhone}
              onChange={(e) => {
                set('emergencyContactPhone')(e.target.value);
              }}
            />
          </Field>
          <p className="text-xs text-muted-foreground sm:col-span-2">{t('loginHint')}</p>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {tc('cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                busy || form.licenseCategories.length === 0 || form.transportTypes.length === 0
              }
            >
              {busy ? <Loader2 className="animate-spin" /> : null}
              {t('submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DriverDialog({
  driver: initial,
  canEdit,
  canApprove,
  canVerifyDocs,
  onClose,
}: {
  driver: DriverDto;
  canEdit: boolean;
  canApprove: boolean;
  canVerifyDocs: boolean;
  onClose: () => void;
}) {
  const t = useTranslations('portal.drivers');
  const td = useTranslations('portal.admin.documents');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [driver, setDriver] = useState(initial);
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checklistKey, setChecklistKey] = useState(0);

  const refresh = useCallback(async () => {
    const [d, docsRes] = await Promise.all([
      api<DriverDto>(`/drivers/${initial.id}`),
      canVerifyDocs
        ? api<DocumentDto[]>('/documents', {
            query: { driverProfileId: initial.id, uploadStatus: 'UPLOADED', pageSize: 100 },
          })
        : Promise.resolve(null),
    ]);
    if (d.ok) setDriver(d.data);
    if (docsRes?.ok) setDocs(docsRes.data);
    setChecklistKey((k) => k + 1);
  }, [initial.id, canVerifyDocs]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(
    key: string,
    fn: () => Promise<{ ok: boolean; error?: ApiError }>,
    done: string,
  ) {
    setBusy(key);
    setError(null);
    setNotice(null);
    const res = await fn();
    setBusy(null);
    if (res.ok) {
      setNotice(done);
      await refresh();
    } else if (res.error) setError(res.error);
  }
  const verifyDoc = (d: DocumentDto, action: 'verify' | 'reject') => {
    void run(
      d.id,
      () =>
        api<DocumentDto>(`/documents/${d.id}/${action}`, {
          method: 'POST',
          body:
            action === 'reject' ? { rejectionReason: reason.trim() || 'Rejected by reviewer' } : {},
        }),
      action === 'verify' ? t('docVerified') : t('docRejected'),
    );
  };
  async function open(d: DocumentDto) {
    const res = await api<DownloadUrlDto>(`/documents/${d.id}/download-url`);
    if (res.ok) window.open(res.data.url, '_blank', 'noopener');
    else setError(res.error);
  }
  const missing = (error?.details as { missing?: string[] } | undefined)?.missing;
  const applied = driver.verticals.map((v) => v.transportType);
  const pendingDocs = docs.filter((d) => d.verificationStatus === 'PENDING').length;
  // A vertical added after approval stays NOT_APPLIED until staff approve again (documents re-checked).
  const pendingVerticals = driver.verticals.filter(
    (v) => v.status !== 'APPROVED' && v.status !== 'REJECTED',
  );
  const needsApproval = driver.approvalStatus !== 'APPROVED' || pendingVerticals.length > 0;
  const addVertical = (transportType: string) => {
    void run(
      'vertical',
      () =>
        api<DriverDto>(`/drivers/${driver.id}`, {
          method: 'PATCH',
          body: { transportTypes: [...applied, transportType] },
        }),
      t('verticalAdded'),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>
            {(locale === 'ar' ? driver.fullNameAr : null) ?? driver.fullNameEn}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={APPROVAL_TONE[driver.approvalStatus] ?? 'outline'}>
            {t(`statuses.${driver.approvalStatus}` as 'statuses.DRAFT')}
          </Badge>
          <Badge variant="outline">
            {t(`availabilities.${driver.availabilityStatus}` as 'availabilities.OFF_DUTY')}
          </Badge>
          <span className="text-muted-foreground" dir="ltr">
            {driver.phoneE164 ?? '—'} ·{' '}
            {t('licenceEnding', { last4: driver.licenseNumberLast4 ?? '????' })} ·{' '}
            {driver.licenseCategories.join(', ')}
          </span>
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>
              {errorMessage(tc, error)}
              {missing?.length ? (
                <span className="ms-1 font-mono text-xs">({missing.join(', ')})</span>
              ) : null}
            </AlertDescription>
          </Alert>
        )}
        {notice && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t('verticals')}:</span>
          {driver.verticals.map((v) => (
            <Badge
              key={v.transportType}
              variant={
                v.status === 'APPROVED'
                  ? 'default'
                  : v.status === 'REJECTED'
                    ? 'destructive'
                    : 'secondary'
              }
            >
              {t(`vertical.${v.transportType}` as 'vertical.PASSENGER')} ·{' '}
              {t(`verticalStatus.${v.status}` as 'verticalStatus.NOT_APPLIED')}
            </Badge>
          ))}
          {canEdit &&
            (['PASSENGER', 'GOODS'] as const)
              .filter((v) => !applied.includes(v))
              .map((v) => (
                <Button
                  key={v}
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() => {
                    addVertical(v);
                  }}
                >
                  <Plus className="size-4" />
                  {t('addVertical', { vertical: t(`vertical.${v}`) })}
                </Button>
              ))}
        </div>

        <DocumentChecklist
          key={checklistKey}
          target={{
            kind: 'DRIVER',
            id: driver.id,
            label: driver.fullNameEn,
            ...(applied.length === 1 ? { transportType: applied[0] as 'PASSENGER' | 'GOODS' } : {}),
          }}
          onChanged={() => void refresh()}
        />

        {canVerifyDocs && (
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base">{td('title')}</CardTitle>
              <CardDescription>{td('pendingCount', { count: pendingDocs })}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 p-4 pt-0">
              {docs.length === 0 && <p className="text-sm text-muted-foreground">{t('noDocs')}</p>}
              {docs.map((d) => (
                <div
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{d.documentTypeCode}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {d.originalFilename} · {d.expiryDate ?? '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Badge
                      variant={
                        d.verificationStatus === 'VERIFIED'
                          ? 'default'
                          : d.verificationStatus === 'PENDING'
                            ? 'secondary'
                            : 'destructive'
                      }
                    >
                      {d.verificationStatus}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void open(d)}
                      aria-label={td('download')}
                    >
                      <ExternalLink />
                    </Button>
                    {d.verificationStatus !== 'VERIFIED' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === d.id}
                          onClick={() => {
                            verifyDoc(d, 'verify');
                          }}
                        >
                          {td('verify')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy === d.id}
                          onClick={() => {
                            verifyDoc(d, 'reject');
                          }}
                        >
                          {td('reject')}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {canApprove && needsApproval && (
          <div className="space-y-2">
            <Label htmlFor="drv-reason">{t('rejectReason')}</Label>
            <Input
              id="drv-reason"
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
              }}
            />
            <DialogFooter>
              <Button
                variant="destructive"
                disabled={busy !== null || reason.trim().length < 5}
                onClick={() =>
                  void run(
                    'reject',
                    () =>
                      api<DriverDto>(`/drivers/${driver.id}/reject`, {
                        method: 'POST',
                        body: { rejectionReason: reason.trim() },
                      }),
                    t('rejected'),
                  )
                }
              >
                {busy === 'reject' ? <Loader2 className="animate-spin" /> : null}
                {t('reject')}
              </Button>
              <Button
                disabled={busy !== null}
                onClick={() =>
                  void run(
                    'approve',
                    () =>
                      api<DriverDto>(`/drivers/${driver.id}/approve`, { method: 'POST', body: {} }),
                    t('approved'),
                  )
                }
              >
                {busy === 'approve' ? <Loader2 className="animate-spin" /> : null}
                {t('approve')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
