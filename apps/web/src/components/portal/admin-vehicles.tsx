'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import type { DocumentDto, DownloadUrlDto, VehicleDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { APPROVAL_TONE } from './fleet-list';

const STATUSES = ['PENDING_APPROVAL', 'DRAFT', 'APPROVED', 'REJECTED'] as const;

/** Vehicle approval queue for staff: verify pending documents, then approve or reject. */
export function AdminVehicles() {
  const { can } = useSession();
  const t = useTranslations('portal.admin.vehicles');
  const tf = useTranslations('portal.fleet');
  const to = useTranslations('portal.admin.owners');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [status, setStatus] = useState<string>('PENDING_APPROVAL');
  const [rows, setRows] = useState<VehicleDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<VehicleDto | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    const res = await api<VehicleDto[]>('/vehicles', { query: { approvalStatus: status === 'ALL' ? undefined : status, pageSize: 50 } });
    if (res.ok) setRows(res.data);
    else {
      setRows([]);
      setError(res.error);
    }
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  async function decide(v: VehicleDto, action: 'approve' | 'reject', reason?: string) {
    setError(null);
    setNotice(null);
    const res = await api<VehicleDto>(`/vehicles/${v.id}/${action}`, { method: 'POST', body: action === 'reject' ? { rejectionReason: reason } : {} });
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setNotice(action === 'approve' ? t('approved') : t('rejected'));
    setSelected(null);
    await load();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <div className="w-48 space-y-1">
          <Label>{to('filter')}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{to('all')}</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {tf(`status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                <TableHead>{t('vehicle')}</TableHead>
                <TableHead>{tf('category')}</TableHead>
                <TableHead>{tf('approval')}</TableHead>
                <TableHead>{tf('dispatchable')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    <Loader2 className="inline size-4 animate-spin" />
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <div className="font-medium" dir="ltr">
                        {v.plateNumberEn}
                      </div>
                      <div className="text-xs text-muted-foreground">{[v.make?.name, v.model?.name, v.modelYear].filter(Boolean).join(' ')}</div>
                    </TableCell>
                    <TableCell>{locale === 'ar' ? v.category.nameAr : v.category.nameEn}</TableCell>
                    <TableCell>
                      <Badge variant={APPROVAL_TONE[v.approvalStatus] ?? 'outline'}>{tf(`status.${v.approvalStatus}` as 'status.DRAFT')}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={v.dispatchable.ok ? 'default' : 'outline'}>{v.dispatchable.ok ? tf('dispatchable') : tf('notDispatchable')}</Badge>
                    </TableCell>
                    <TableCell className="text-end">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelected(v);
                        }}
                      >
                        {t('review')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {selected && (
        <VehicleReviewDialog
          vehicle={selected}
          canApprove={can('vehicles.approve')}
          canVerify={can('documents.verify')}
          onDecide={decide}
          onClose={() => {
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

function VehicleReviewDialog({ vehicle, canApprove, canVerify, onDecide, onClose }: { vehicle: VehicleDto; canApprove: boolean; canVerify: boolean; onDecide: (v: VehicleDto, a: 'approve' | 'reject', reason?: string) => Promise<void>; onClose: () => void }) {
  const t = useTranslations('portal.admin.vehicles');
  const td = useTranslations('portal.admin.documents');
  const tc = useTranslations('common');
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const load = useCallback(async () => {
    const res = await api<DocumentDto[]>('/documents', { query: { vehicleId: vehicle.id, uploadStatus: 'UPLOADED', pageSize: 100 } });
    setDocs(res.ok ? res.data : []);
  }, [vehicle.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function verify(d: DocumentDto, action: 'verify' | 'reject') {
    setBusy(d.id);
    setError(null);
    const res = await api<DocumentDto>(`/documents/${d.id}/${action}`, { method: 'POST', body: action === 'reject' ? { rejectionReason: reason || 'Rejected by reviewer' } : {} });
    setBusy(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    await load();
  }
  async function open(d: DocumentDto) {
    const res = await api<DownloadUrlDto>(`/documents/${d.id}/download-url`);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.open(res.data.url, '_blank', 'noopener');
  }
  const pending = docs.filter((d) => d.verificationStatus === 'PENDING').length;

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle dir="ltr">{vehicle.plateNumberEn}</DialogTitle>
        </DialogHeader>
        {!vehicle.dispatchable.ok && (
          <div className="flex flex-wrap gap-1">
            {vehicle.dispatchable.reasons.map((r) => (
              <Badge key={r} variant="outline" className="font-mono text-xs">
                {r}
              </Badge>
            ))}
          </div>
        )}
        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base">{td('title')}</CardTitle>
            <CardDescription>{td('pendingCount', { count: pending })}</CardDescription>
          </CardHeader>
          <CardContent className="max-h-72 space-y-2 overflow-y-auto p-4 pt-0">
            {docs.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{d.documentTypeCode}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {d.originalFilename} · {d.expiryDate ?? '—'}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant={d.verificationStatus === 'VERIFIED' ? 'default' : d.verificationStatus === 'PENDING' ? 'secondary' : 'destructive'}>{d.verificationStatus}</Badge>
                  <Button size="sm" variant="ghost" onClick={() => void open(d)} aria-label={td('download')}>
                    <ExternalLink />
                  </Button>
                  {canVerify && d.verificationStatus !== 'VERIFIED' && (
                    <>
                      <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => void verify(d, 'verify')}>
                        {td('verify')}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => void verify(d, 'reject')}>
                        {td('reject')}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
          </Alert>
        )}
        <div className="space-y-2">
          <Label htmlFor="vreason">{t('rejectReason')}</Label>
          <Input
            id="vreason"
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
            }}
          />
        </div>
        <DialogFooter>
          {canApprove && vehicle.approvalStatus === 'PENDING_APPROVAL' && (
            <>
              <Button variant="destructive" disabled={reason.trim().length < 5} onClick={() => void onDecide(vehicle, 'reject', reason.trim())}>
                {t('reject')}
              </Button>
              <Button disabled={pending > 0} onClick={() => void onDecide(vehicle, 'approve')}>
                {t('approve')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
