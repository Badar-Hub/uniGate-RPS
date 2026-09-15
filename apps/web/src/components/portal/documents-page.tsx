'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, CheckCircle2, Loader2, Upload } from 'lucide-react';
import type { CustomerDto, DocumentRequirementDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { uploadDocument } from '@/lib/documents/upload';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Target {
  kind: 'USER' | 'OWNER' | 'CORPORATE_CUSTOMER';
  id: string;
  label: string;
  transportType?: 'PASSENGER' | 'GOODS';
}

const TONE: Record<DocumentRequirementDto['status'], 'default' | 'secondary' | 'destructive' | 'outline'> = {
  MISSING: 'outline',
  PENDING: 'secondary',
  VERIFIED: 'default',
  REJECTED: 'destructive',
  EXPIRED: 'destructive',
};

/** The actor's document checklists (identity, owner business, company) with the presigned upload. */
export function DocumentsPage() {
  const { me } = useSession();
  const t = useTranslations('portal.documents');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [targets, setTargets] = useState<Target[]>([]);
  const [lists, setLists] = useState<Record<string, DocumentRequirementDto[]>>({});
  const [error, setError] = useState<ApiError | null>(null);
  const [dialog, setDialog] = useState<{ target: Target; req: DocumentRequirementDto } | null>(null);

  useEffect(() => {
    if (!me) return;
    const next: Target[] = [];
    if (me.profiles.owner) {
      next.push({ kind: 'OWNER', id: me.profiles.owner.id, label: t('targetOwner'), transportType: 'PASSENGER' });
      next.push({ kind: 'USER', id: me.id, label: t('targetUser') });
    }
    if (me.profiles.customer) {
      void api<CustomerDto>(`/customers/${me.profiles.customer.id}`).then((res) => {
        if (res.ok && res.data.corporate) setTargets((cur) => [...cur, { kind: 'CORPORATE_CUSTOMER', id: res.data.corporate?.id ?? '', label: t('targetCorporate') }]);
      });
    }
    setTargets(next);
  }, [me, t]);

  const load = useCallback(async () => {
    setError(null);
    const entries = await Promise.all(
      targets.map(async (tg) => {
        const res = await api<DocumentRequirementDto[]>('/documents/requirements', { query: { appliesTo: tg.kind, targetId: tg.id, transportType: tg.transportType } });
        if (!res.ok) setError(res.error);
        return [tg.id, res.ok ? res.data : []] as const;
      }),
    );
    setLists(Object.fromEntries(entries));
  }, [targets]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
        </Alert>
      )}
      {targets.length === 0 && <p className="text-sm text-muted-foreground">{t('noChecklist')}</p>}
      {targets.map((tg) => (
        <Card key={tg.id}>
          <CardHeader>
            <CardTitle>{t('checklistFor', { target: tg.label })}</CardTitle>
            <CardDescription>{t('accepted')}</CardDescription>
          </CardHeader>
          <CardContent className="divide-y">
            {(lists[tg.id] ?? []).map((r) => (
              <div key={r.documentTypeCode} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{locale === 'ar' ? r.nameAr : r.nameEn}</span>
                    <Badge variant="outline" className="font-normal">
                      {r.isMandatory ? t('mandatory') : t('optional')}
                    </Badge>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant={TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
                    {r.expiryDate && <span>{t('expires', { date: r.expiryDate })}</span>}
                  </div>
                </div>
                {r.status !== 'VERIFIED' && (
                  <Button size="sm" variant={r.status === 'MISSING' ? 'default' : 'outline'} onClick={() => { setDialog({ target: tg, req: r }); }}>
                    <Upload />
                    {r.status === 'MISSING' ? t('upload') : t('replace')}
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      {dialog && (
        <UploadDialog
          target={dialog.target}
          req={dialog.req}
          locale={locale === 'ar' ? 'ar' : 'en'}
          onClose={(changed) => {
            setDialog(null);
            if (changed) void load();
          }}
        />
      )}
    </div>
  );
}

function UploadDialog({ target, req, locale, onClose }: { target: Target; req: DocumentRequirementDto; locale: 'ar' | 'en'; onClose: (changed: boolean) => void }) {
  const t = useTranslations('portal.documents');
  const tc = useTranslations('common');
  const [file, setFile] = useState<File | null>(null);
  const [issueDate, setIssueDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    const res = await uploadDocument({
      documentTypeCode: req.documentTypeCode,
      target: { kind: target.kind, id: target.id },
      file,
      ...(issueDate ? { issueDate } : {}),
      ...(expiryDate ? { expiryDate } : {}),
      visibility: 'INTERNAL',
      onProgress: setStage,
    });
    setStage(null);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(done); }}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{t('dialogTitle', { name: locale === 'ar' ? req.nameAr : req.nameEn })}</DialogTitle>
        </DialogHeader>
        {done ? (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>{t('uploaded')}</AlertDescription>
          </Alert>
        ) : (
          <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label htmlFor="file">{t('file')}</Label>
              <Input id="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => { setFile(e.target.files?.[0] ?? null); }} required />
              <p className="text-xs text-muted-foreground">{t('accepted')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="issueDate">{t('issueDate')}</Label>
                <Input id="issueDate" type="date" value={issueDate} onChange={(e) => { setIssueDate(e.target.value); }} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="expiryDate">{t('expiryDate')}</Label>
                <Input id="expiryDate" type="date" value={expiryDate} onChange={(e) => { setExpiryDate(e.target.value); }} required={req.requiresExpiry} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { onClose(false); }}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={!file || Boolean(stage)}>
                {stage && <Loader2 className="animate-spin" />}
                {stage ? t('uploading') : t('upload')}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
