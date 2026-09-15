'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Copy, Loader2 } from 'lucide-react';
import type { OwnerDto, VendorCreatedDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage } from '@/lib/errors';
import { Link } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const TONE: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = { DRAFT: 'secondary', DOCUMENTS_SUBMITTED: 'default', UNDER_REVIEW: 'default', APPROVED: 'outline', REJECTED: 'destructive', SUSPENDED: 'destructive' };

/**
 * Vendors (third-party vehicle owners) are added by UniGate admins only. The form creates the account
 * and the owner profile and shows the one-time activation link; the list tracks every vendor's
 * onboarding state and links to the review queue and the per-vendor access matrix.
 */
export function AdminVendors() {
  const t = useTranslations('portal.vendors');
  const tc = useTranslations('common');
  const { can } = useSession();
  const [rows, setRows] = useState<OwnerDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<VendorCreatedDto | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ fullNameEn: '', email: '', phoneE164: '', ownerType: 'COMPANY', businessNameEn: '', crNumber: '', passenger: true, goods: false });

  const load = useCallback(async () => {
    const res = await api<OwnerDto[]>('/owners', { query: { pageSize: 100 } });
    if (res.ok) setRows(res.data.filter((o) => !o.isPlatformFleet));
    else setError(res.error);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const transportTypes = [...(form.passenger ? ['PASSENGER'] : []), ...(form.goods ? ['GOODS'] : [])];
    const body = {
      email: form.email.trim(), ...(form.phoneE164.trim() ? { phoneE164: form.phoneE164.trim() } : {}), fullNameEn: form.fullNameEn.trim(), ownerType: form.ownerType,
      ...(form.businessNameEn.trim() ? { businessNameEn: form.businessNameEn.trim() } : {}), ...(form.crNumber.trim() ? { crNumber: form.crNumber.trim() } : {}), transportTypes,
    };
    const res = await api<VendorCreatedDto>('/admin/vendors', { method: 'POST', body });
    setBusy(false);
    if (res.ok) {
      setCreated(res.data);
      setForm({ fullNameEn: '', email: '', phoneE164: '', ownerType: 'COMPANY', businessNameEn: '', crNumber: '', passenger: true, goods: false });
      await load();
    } else setError(res.error);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      {created && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">{t('createdTitle', { name: created.user.fullNameEn })}</CardTitle>
            <CardDescription>{t('createdHint', { until: new Date(created.activationExpiresAt).toLocaleString() })} {t(`delivery.${created.activationDelivery}`)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Input readOnly dir="ltr" className="min-w-0 flex-1 font-mono text-xs" value={created.activationUrl} onFocus={(e) => { e.currentTarget.select(); }} />
            <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(created.activationUrl).then(() => { setCopied(true); }); }}>
              <Copy className="size-4" />
              {copied ? t('copied') : t('copy')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setCreated(null); setCopied(false); }}>{tc('close')}</Button>
          </CardContent>
        </Card>
      )}
      {can('users.create') && can('owners.create') && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('add')}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => void submit(e)}>
              <div className="space-y-1">
                <Label htmlFor="v-name">{t('contactName')}</Label>
                <Input id="v-name" required value={form.fullNameEn} onChange={(e) => { setForm({ ...form, fullNameEn: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-email">{t('email')}</Label>
                <Input id="v-email" type="email" required dir="ltr" value={form.email} onChange={(e) => { setForm({ ...form, email: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-phone">{t('phone')}</Label>
                <Input id="v-phone" type="tel" dir="ltr" placeholder="+9665XXXXXXXX" value={form.phoneE164} onChange={(e) => { setForm({ ...form, phoneE164: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-type">{t('ownerType')}</Label>
                <select id="v-type" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={form.ownerType} onChange={(e) => { setForm({ ...form, ownerType: e.target.value }); }}>
                  <option value="COMPANY">{t('types.COMPANY')}</option>
                  <option value="INDIVIDUAL">{t('types.INDIVIDUAL')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-biz">{t('businessName')}</Label>
                <Input id="v-biz" value={form.businessNameEn} onChange={(e) => { setForm({ ...form, businessNameEn: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="v-cr">{t('crNumber')}</Label>
                <Input id="v-cr" dir="ltr" inputMode="numeric" maxLength={10} value={form.crNumber} onChange={(e) => { setForm({ ...form, crNumber: e.target.value.replace(/[^\d]/g, '') }); }} />
              </div>
              <div className="flex items-end gap-4 sm:col-span-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.passenger} onChange={(e) => { setForm({ ...form, passenger: e.target.checked }); }} />{t('verticals.PASSENGER')}</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.goods} onChange={(e) => { setForm({ ...form, goods: e.target.checked }); }} />{t('verticals.GOODS')}</label>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || !form.email || form.fullNameEn.length < 2 || (!form.passenger && !form.goods)}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t('create')}
                </Button>
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
                <TableHead>{t('vendor')}</TableHead>
                <TableHead>{t('contact')}</TableHead>
                <TableHead>{t('ownerType')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-medium">{o.businessNameEn ?? o.fullNameEn}</TableCell>
                    <TableCell className="text-sm text-muted-foreground" dir="ltr">{[o.fullNameEn, o.email].filter(Boolean).join(' · ')}</TableCell>
                    <TableCell className="text-sm">{t(`types.${o.ownerType}` as 'types.COMPANY')}</TableCell>
                    <TableCell><Badge variant={TONE[o.onboardingStatus] ?? 'secondary'}>{t(`status.${o.onboardingStatus}` as 'status.DRAFT')}</Badge></TableCell>
                    <TableCell className="space-x-2 text-end">
                      {(o.onboardingStatus === 'DOCUMENTS_SUBMITTED' || o.onboardingStatus === 'UNDER_REVIEW') && <Link href="/admin/owners" className="text-sm text-primary underline-offset-4 hover:underline">{t('review')}</Link>}
                      {can('permissions.assign') && <Link href={`/admin/vendors/${o.userId}/access`} className="text-sm text-primary underline-offset-4 hover:underline">{t('accessLink')}</Link>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
