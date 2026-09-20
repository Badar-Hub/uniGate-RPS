'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import type { DocumentDto, DownloadUrlDto, OwnerDto } from '@unigate/types';
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

const STATUSES = ['UNDER_REVIEW', 'DRAFT', 'DOCUMENTS_SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;

/** Owner approval queue: verify each pending document, then approve or reject the profile. */
export function AdminOwners() {
  const { can } = useSession();
  const t = useTranslations('portal.admin.owners');
  const tc = useTranslations('common');
  const [status, setStatus] = useState<string>('UNDER_REVIEW');
  const [rows, setRows] = useState<OwnerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<OwnerDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api<OwnerDto[]>('/owners', { query: { onboardingStatus: status === 'ALL' ? undefined : status, pageSize: 50 } });
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setRows(res.data);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(owner: OwnerDto, action: 'approve' | 'reject', reason?: string) {
    setError(null);
    setNotice(null);
    const res = await api<OwnerDto>(`/owners/${owner.id}/${action}`, { method: 'POST', body: action === 'reject' ? { rejectionReason: reason } : {} });
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
          <Label>{t('filter')}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('all')}</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
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
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('type')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('submitted')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
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
                rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <div className="font-medium">{o.businessNameEn ?? o.fullNameEn}</div>
                      <div className="text-xs text-muted-foreground">{o.fullNameEn}</div>
                    </TableCell>
                    <TableCell>{o.ownerType}</TableCell>
                    <TableCell>
                      <Badge variant={o.onboardingStatus === 'APPROVED' ? 'default' : o.onboardingStatus === 'UNDER_REVIEW' ? 'secondary' : 'outline'}>{o.onboardingStatus}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(o.updatedAt).toLocaleString()}</TableCell>
                    <TableCell className="text-end">
                      <Button size="sm" variant="outline" onClick={() => { setSelected(o); }}>
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
      {selected && <OwnerReviewDialog owner={selected} canApprove={can('owners.approve')} canVerify={can('documents.verify')} onDecide={decide} onChanged={(o) => { setSelected(o); setRows((r) => r.map((x) => (x.id === o.id ? o : x))); }} onClose={() => { setSelected(null); }} />}
    </div>
  );
}

const VERTICALS = ['PASSENGER', 'GOODS'] as const;

function OwnerReviewDialog({ owner, canApprove, canVerify, onDecide, onChanged, onClose }: { owner: OwnerDto; canApprove: boolean; canVerify: boolean; onDecide: (o: OwnerDto, a: 'approve' | 'reject', reason?: string) => Promise<void>; onChanged: (o: OwnerDto) => void; onClose: () => void }) {
  const t = useTranslations('portal.admin.owners');
  const td = useTranslations('portal.admin.documents');
  const tc = useTranslations('common');
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [verticals, setVerticals] = useState<string[]>(owner.verticals.map((v) => v.transportType));
  const [savingVerticals, setSavingVerticals] = useState(false);
  const verticalsDirty = VERTICALS.some((v) => verticals.includes(v) !== owner.verticals.some((x) => x.transportType === v));

  // Admin changes the vendor's verticals; the API refuses a removal once the vendor has taken part in anything.
  async function saveVerticals() {
    setSavingVerticals(true);
    setError(null);
    const res = await api<OwnerDto>(`/owners/${owner.id}/verticals`, { method: 'PUT', body: { transportTypes: verticals } });
    setSavingVerticals(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onChanged(res.data);
  }

  const load = useCallback(async () => {
    const [own, identity] = await Promise.all([
      api<DocumentDto[]>('/documents', { query: { ownerProfileId: owner.id, uploadStatus: 'UPLOADED', pageSize: 100 } }),
      api<DocumentDto[]>('/documents', { query: { userId: owner.userId, uploadStatus: 'UPLOADED', pageSize: 100 } }),
    ]);
    setDocs([...(own.ok ? own.data : []), ...(identity.ok ? identity.data : [])]);
  }, [owner.id, owner.userId]);

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
  // An approved vendor with a vertical added later comes back for approval of that vertical alone.
  const verticalPending = owner.onboardingStatus === 'APPROVED' && owner.verticals.some((v) => v.status === 'UNDER_REVIEW' || v.status === 'NOT_APPLIED');

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{owner.businessNameEn ?? owner.fullNameEn}</DialogTitle>
        </DialogHeader>
        {canApprove && owner.ownerType !== 'PLATFORM' && (
          <Card>
            <CardHeader className="p-4">
              <CardTitle className="text-base">{t('verticals.title')}</CardTitle>
              <CardDescription>{t('verticals.hint')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4 p-4 pt-0">
              {VERTICALS.map((v) => {
                const current = owner.verticals.find((x) => x.transportType === v);
                return (
                  <label key={v} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={verticals.includes(v)} disabled={savingVerticals} onChange={(e) => { setVerticals((cur) => (e.target.checked ? [...cur, v] : cur.filter((x) => x !== v))); }} />
                    {t(`verticals.${v}`)}
                    {current && <Badge variant={current.status === 'APPROVED' ? 'default' : 'outline'}>{current.status}</Badge>}
                  </label>
                );
              })}
              <Button size="sm" variant="outline" disabled={!verticalsDirty || verticals.length === 0 || savingVerticals} onClick={() => void saveVerticals()}>
                {savingVerticals && <Loader2 className="animate-spin" />}
                {t('verticals.save')}
              </Button>
            </CardContent>
          </Card>
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
          <Label htmlFor="reason">{t('rejectReason')}</Label>
          <Input id="reason" value={reason} onChange={(e) => { setReason(e.target.value); }} />
        </div>
        <DialogFooter>
          {canApprove && ['UNDER_REVIEW', 'DOCUMENTS_SUBMITTED', 'DRAFT'].includes(owner.onboardingStatus) && (
            <Button variant="destructive" disabled={reason.trim().length < 5} onClick={() => void onDecide(owner, 'reject', reason.trim())}>
              {t('reject')}
            </Button>
          )}
          {canApprove && (['UNDER_REVIEW', 'DOCUMENTS_SUBMITTED'].includes(owner.onboardingStatus) || verticalPending) && (
            <Button disabled={pending > 0} onClick={() => void onDecide(owner, 'approve')}>
              {verticalPending ? t('verticals.approve') : t('approve')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
