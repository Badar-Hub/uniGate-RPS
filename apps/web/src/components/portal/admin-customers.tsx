'use client';

import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, BadgeCheck, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import type { CityDto, CustomerCreditDto, CustomerDto, DocumentDto, DownloadUrlDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage, fieldErrors, unmappedFieldErrors } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

const select = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const CREDIT_STATUSES = ['NONE', 'PENDING_APPROVAL', 'APPROVED', 'SUSPENDED'] as const;
const BILLING_CYCLES = ['PER_BOOKING', 'WEEKLY', 'MONTHLY'] as const;

function Field({ id, label, error, children, className }: { id: string; label: string; error?: string | undefined; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * Customers admin (api.md §8.7): list customers, keep the corporate record (company, CR, national
 * address, contact, billing cycle), set the VAT number, verify the corporate documents and the
 * record, and manage credit. A corporate customer with APPROVED credit and a WEEKLY/MONTHLY
 * cycle is billed by invoice — their bookings confirm without an upfront payment (A-46).
 */
export function AdminCustomers() {
  const { can } = useSession();
  const t = useTranslations('portal.admin.customers');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<CustomerDto[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<CustomerDto | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    const res = await api<CustomerDto[]>('/customers', { query: { pageSize: 50, ...(q.trim() ? { q: q.trim() } : {}) } });
    if (res.ok) setRows(res.data);
    else {
      setRows([]);
      setError(res.error);
    }
  }, [q]);
  useEffect(() => {
    void load();
  }, [load]);

  const name = (c: CustomerDto) => (locale === 'ar' ? c.fullNameAr : null) ?? c.fullNameEn;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Input className="w-64" placeholder={t('search')} value={q} onChange={(e) => { setQ(e.target.value); }} aria-label={t('search')} />
      </div>
      {error && (
        <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
      )}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('customer')}</TableHead>
                <TableHead>{t('type')}</TableHead>
                <TableHead>{t('company')}</TableHead>
                <TableHead>{t('billing')}</TableHead>
                <TableHead>{t('credit')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                rows.map((c) => {
                  const invoiced = c.corporate?.creditStatus === 'APPROVED' && c.corporate.billingCycle !== 'PER_BOOKING';
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="font-medium">{name(c)}</div>
                        <div className="text-xs text-muted-foreground" dir="ltr">{c.email ?? c.phoneE164 ?? '—'}</div>
                      </TableCell>
                      <TableCell>{t(`types.${c.customerType}` as 'types.INDIVIDUAL')}</TableCell>
                      <TableCell>
                        {c.corporate ? (
                          <>
                            <div>{locale === 'ar' ? c.corporate.companyNameAr : c.corporate.companyNameEn}</div>
                            <div className="text-xs text-muted-foreground">{c.corporate.isVerified ? <span className="inline-flex items-center gap-1"><BadgeCheck className="size-3" />{t('verified')}</span> : t('unverified')}</div>
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell><Badge variant={invoiced ? 'default' : 'outline'}>{invoiced ? t('billingModes.INVOICED', { cycle: t(`cycles.${c.corporate?.billingCycle ?? 'PER_BOOKING'}` as 'cycles.MONTHLY') }) : t('billingModes.PREPAID')}</Badge></TableCell>
                      <TableCell>{c.corporate ? <span dir="ltr">{t(`creditStatuses.${c.corporate.creditStatus}` as 'creditStatuses.NONE')} · {c.corporate.creditLimitAmount} SAR</span> : '—'}</TableCell>
                      <TableCell className="text-end">
                        <Button size="sm" variant="outline" onClick={() => { setSelected(c); }}>{t('manage')}</Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {selected && (
        <CustomerDialog
          customer={selected}
          canEdit={can('customers.update')}
          canVerify={can('customers.verify')}
          canVerifyDocs={can('documents.verify')}
          canReadCredit={can('invoices.read')}
          onClose={() => { setSelected(null); void load(); }}
        />
      )}
    </div>
  );
}

interface CorporateForm { companyNameEn: string; companyNameAr: string; crNumber: string; contactPersonName: string; contactPersonPhone: string; contactPersonEmail: string; buildingNumber: string; streetEn: string; streetAr: string; districtEn: string; districtAr: string; cityId: string; postalCode: string; additionalNumber: string; shortCode: string; billingCycle: string; creditTermsDays: string }

function corporateForm(c: CustomerDto): CorporateForm {
  const k = c.corporate;
  const a = k?.nationalAddress;
  return {
    companyNameEn: k?.companyNameEn ?? '', companyNameAr: k?.companyNameAr ?? '', crNumber: k?.crNumber ?? '',
    contactPersonName: k?.contactPersonName ?? '', contactPersonPhone: k?.contactPersonPhone ?? '', contactPersonEmail: k?.contactPersonEmail ?? '',
    buildingNumber: a?.buildingNumber ?? '', streetEn: a?.streetEn ?? '', streetAr: a?.streetAr ?? '', districtEn: a?.districtEn ?? '', districtAr: a?.districtAr ?? '', cityId: a?.cityId ?? '', postalCode: a?.postalCode ?? '', additionalNumber: a?.additionalNumber ?? '', shortCode: a?.shortCode ?? '',
    billingCycle: k?.billingCycle ?? 'MONTHLY', creditTermsDays: String(k?.creditTermsDays ?? 30),
  };
}

function CustomerDialog({ customer: initial, canEdit, canVerify, canVerifyDocs, canReadCredit, onClose }: { customer: CustomerDto; canEdit: boolean; canVerify: boolean; canVerifyDocs: boolean; canReadCredit: boolean; onClose: () => void }) {
  const t = useTranslations('portal.admin.customers');
  const td = useTranslations('portal.admin.documents');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [customer, setCustomer] = useState(initial);
  const [cities, setCities] = useState<CityDto[]>([]);
  const [form, setForm] = useState<CorporateForm>(() => corporateForm(initial));
  const [vat, setVat] = useState({ vatNumber: initial.vatNumber ?? '', reason: '' });
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [credit, setCredit] = useState<CustomerCreditDto | null>(null);
  const [creditForm, setCreditForm] = useState({ creditStatus: '', creditLimitAmount: '', creditTermsDays: '', billingCycle: '', reason: '' });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fe = fieldErrors(error);
  const set = (k: keyof CorporateForm) => (v: string) => { setForm((f) => ({ ...f, [k]: v })); };

  const refresh = useCallback(async () => {
    const c = await api<CustomerDto>(`/customers/${initial.id}`);
    if (c.ok) setCustomer(c.data);
    const corpId = c.ok ? c.data.corporate?.id : initial.corporate?.id;
    if (corpId) {
      const d = await api<DocumentDto[]>('/documents', { query: { corporateCustomerProfileId: corpId, uploadStatus: 'UPLOADED', pageSize: 100 } });
      setDocs(d.ok ? d.data : []);
    }
    if (canReadCredit && (c.ok ? c.data.corporate : initial.corporate)) {
      const cr = await api<CustomerCreditDto>(`/customers/${initial.id}/credit`);
      if (cr.ok) {
        setCredit(cr.data);
        setCreditForm({ creditStatus: cr.data.creditStatus, creditLimitAmount: cr.data.creditLimitAmount, creditTermsDays: String(cr.data.creditTermsDays), billingCycle: cr.data.billingCycle, reason: '' });
      }
    }
  }, [initial.id, initial.corporate, canReadCredit]);
  useEffect(() => {
    void refresh();
    void api<CityDto[]>('/reference/cities').then((r) => { if (r.ok) setCities(r.data); });
  }, [refresh]);

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: ApiError }>, done: string) {
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

  const saveCorporate = (e: SyntheticEvent) => {
    e.preventDefault();
    const addressFilled = [form.buildingNumber, form.streetEn, form.streetAr, form.districtEn, form.districtAr, form.cityId, form.postalCode, form.additionalNumber].some((v) => v.trim());
    const body = {
      companyNameEn: form.companyNameEn.trim(), companyNameAr: form.companyNameAr.trim(), crNumber: form.crNumber.trim(),
      contactPersonName: form.contactPersonName.trim(), contactPersonPhone: form.contactPersonPhone.trim(), contactPersonEmail: form.contactPersonEmail.trim() || null,
      ...(addressFilled ? { nationalAddress: { buildingNumber: form.buildingNumber.trim(), streetEn: form.streetEn.trim(), streetAr: form.streetAr.trim(), districtEn: form.districtEn.trim(), districtAr: form.districtAr.trim(), cityId: form.cityId, postalCode: form.postalCode.trim(), additionalNumber: form.additionalNumber.trim(), ...(form.shortCode.trim() ? { shortCode: form.shortCode.trim().toUpperCase() } : {}) } } : {}),
      billingCycle: form.billingCycle, creditTermsDays: Number(form.creditTermsDays || 30),
    };
    void run('corporate', () => api<CustomerDto>(`/customers/${customer.id}/corporate`, { method: 'PUT', body }), t('corporateSaved'));
  };
  const saveVat = (e: SyntheticEvent) => {
    e.preventDefault();
    void run('vat', () => api<CustomerDto>(`/admin/customers/${customer.id}/vat-number`, { method: 'PATCH', body: { vatNumber: vat.vatNumber.trim() || null, reason: vat.reason.trim() } }), t('vatSaved'));
  };
  const verifyDoc = (d: DocumentDto, action: 'verify' | 'reject') => {
    void run(d.id, () => api<DocumentDto>(`/documents/${d.id}/${action}`, { method: 'POST', body: action === 'reject' ? { rejectionReason: 'Rejected by reviewer' } : {} }), action === 'verify' ? t('docVerified') : t('docRejected'));
  };
  async function open(d: DocumentDto) {
    const res = await api<DownloadUrlDto>(`/documents/${d.id}/download-url`);
    if (res.ok) window.open(res.data.url, '_blank', 'noopener');
    else setError(res.error);
  }
  const verifyCustomer = () => { void run('verify', () => api<CustomerDto>(`/customers/${customer.id}/verify`, { method: 'POST', body: {} }), t('customerVerified')); };
  const saveCredit = (e: SyntheticEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = {};
    if (credit && creditForm.creditStatus !== credit.creditStatus) body['creditStatus'] = creditForm.creditStatus;
    if (credit && Number(creditForm.creditLimitAmount) !== Number(credit.creditLimitAmount)) body['creditLimitAmount'] = Number(creditForm.creditLimitAmount.replace(/[,\s]/g, '')).toFixed(2);
    if (credit && Number(creditForm.creditTermsDays) !== credit.creditTermsDays) body['creditTermsDays'] = Number(creditForm.creditTermsDays);
    if (credit && creditForm.billingCycle !== credit.billingCycle) body['billingCycle'] = creditForm.billingCycle;
    if (creditForm.reason.trim()) body['reason'] = creditForm.reason.trim();
    void run('credit', () => api<CustomerCreditDto>(`/admin/customers/${customer.id}/credit`, { method: 'PATCH', body }), t('creditSaved'));
  };

  const corp = customer.corporate;
  const pendingDocs = docs.filter((d) => d.verificationStatus === 'PENDING').length;
  const unmapped = unmappedFieldErrors(error, ['companyNameEn', 'companyNameAr', 'crNumber', 'contactPersonName', 'contactPersonPhone', 'contactPersonEmail', 'vatNumber', 'reason', 'creditStatus', 'creditLimitAmount', 'creditTermsDays', 'billingCycle', 'nationalAddress.buildingNumber', 'nationalAddress.streetEn', 'nationalAddress.streetAr', 'nationalAddress.districtEn', 'nationalAddress.districtAr', 'nationalAddress.cityId', 'nationalAddress.postalCode', 'nationalAddress.additionalNumber', 'nationalAddress.shortCode']);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto" closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle>{(locale === 'ar' ? customer.fullNameAr : null) ?? customer.fullNameEn}</DialogTitle>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{errorMessage(tc, error)}{unmapped ? ` — ${unmapped}` : ''}</AlertDescription>
          </Alert>
        )}
        {notice && <Alert><CheckCircle2 className="size-4" /><AlertDescription>{notice}</AlertDescription></Alert>}

        <Card>
          <CardHeader className="p-4">
            <CardTitle className="text-base">{t('corporate.title')}</CardTitle>
            <CardDescription>{t('corporate.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={saveCorporate}>
              <Field id="companyNameEn" label={t('corporate.companyNameEn')} error={fe['companyNameEn']}><Input id="companyNameEn" required value={form.companyNameEn} onChange={(e) => { set('companyNameEn')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="companyNameAr" label={t('corporate.companyNameAr')} error={fe['companyNameAr']}><Input id="companyNameAr" required dir="rtl" value={form.companyNameAr} onChange={(e) => { set('companyNameAr')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="crNumber" label={t('corporate.crNumber')} error={fe['crNumber']}><Input id="crNumber" required dir="ltr" inputMode="numeric" maxLength={10} placeholder="1010123456" value={form.crNumber} onChange={(e) => { set('crNumber')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="contactPersonName" label={t('corporate.contactName')} error={fe['contactPersonName']}><Input id="contactPersonName" required value={form.contactPersonName} onChange={(e) => { set('contactPersonName')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="contactPersonPhone" label={t('corporate.contactPhone')} error={fe['contactPersonPhone']}><Input id="contactPersonPhone" required dir="ltr" placeholder="+9665XXXXXXXX" value={form.contactPersonPhone} onChange={(e) => { set('contactPersonPhone')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="contactPersonEmail" label={t('corporate.contactEmail')} error={fe['contactPersonEmail']}><Input id="contactPersonEmail" type="email" dir="ltr" value={form.contactPersonEmail} onChange={(e) => { set('contactPersonEmail')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="billingCycle" label={t('corporate.billingCycle')} error={fe['billingCycle']}>
                <select id="billingCycle" className={select} value={form.billingCycle} onChange={(e) => { set('billingCycle')(e.target.value); }} disabled={!canEdit}>
                  {BILLING_CYCLES.map((c) => <option key={c} value={c}>{t(`cycles.${c}`)}</option>)}
                </select>
              </Field>
              <Field id="creditTermsDays" label={t('corporate.creditTermsDays')} error={fe['creditTermsDays']}><Input id="creditTermsDays" type="number" min={0} max={180} dir="ltr" value={form.creditTermsDays} onChange={(e) => { set('creditTermsDays')(e.target.value); }} disabled={!canEdit} /></Field>
              <p className="text-sm font-medium sm:col-span-2">{t('corporate.nationalAddress')}</p>
              <Field id="buildingNumber" label={t('corporate.buildingNumber')} error={fe['nationalAddress.buildingNumber']}><Input id="buildingNumber" dir="ltr" inputMode="numeric" maxLength={4} value={form.buildingNumber} onChange={(e) => { set('buildingNumber')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="additionalNumber" label={t('corporate.additionalNumber')} error={fe['nationalAddress.additionalNumber']}><Input id="additionalNumber" dir="ltr" inputMode="numeric" maxLength={4} value={form.additionalNumber} onChange={(e) => { set('additionalNumber')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="streetEn" label={t('corporate.streetEn')} error={fe['nationalAddress.streetEn']}><Input id="streetEn" value={form.streetEn} onChange={(e) => { set('streetEn')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="streetAr" label={t('corporate.streetAr')} error={fe['nationalAddress.streetAr']}><Input id="streetAr" dir="rtl" value={form.streetAr} onChange={(e) => { set('streetAr')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="districtEn" label={t('corporate.districtEn')} error={fe['nationalAddress.districtEn']}><Input id="districtEn" value={form.districtEn} onChange={(e) => { set('districtEn')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="districtAr" label={t('corporate.districtAr')} error={fe['nationalAddress.districtAr']}><Input id="districtAr" dir="rtl" value={form.districtAr} onChange={(e) => { set('districtAr')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="cityId" label={t('corporate.city')} error={fe['nationalAddress.cityId']}>
                <select id="cityId" className={select} value={form.cityId} onChange={(e) => { set('cityId')(e.target.value); }} disabled={!canEdit}>
                  <option value="">—</option>
                  {cities.map((c) => <option key={c.id} value={c.id}>{locale === 'ar' ? c.nameAr : c.nameEn}</option>)}
                </select>
              </Field>
              <Field id="postalCode" label={t('corporate.postalCode')} error={fe['nationalAddress.postalCode']}><Input id="postalCode" dir="ltr" inputMode="numeric" maxLength={5} value={form.postalCode} onChange={(e) => { set('postalCode')(e.target.value); }} disabled={!canEdit} /></Field>
              <Field id="shortCode" label={t('corporate.shortCode')} error={fe['nationalAddress.shortCode']}><Input id="shortCode" dir="ltr" placeholder="RHAA1234" maxLength={8} value={form.shortCode} onChange={(e) => { set('shortCode')(e.target.value); }} disabled={!canEdit} /></Field>
              {canEdit && (
                <div className="sm:col-span-2"><Button type="submit" disabled={busy !== null}>{busy === 'corporate' ? <Loader2 className="animate-spin" /> : null}{corp ? t('corporate.save') : t('corporate.create')}</Button></div>
              )}
            </form>
          </CardContent>
        </Card>

        {corp && (
          <>
            <Card>
              <CardHeader className="p-4">
                <CardTitle className="text-base">{t('vat.title')}</CardTitle>
                <CardDescription>{customer.vatNumberLockedAt ? t('vat.locked') : t('vat.hint')}</CardDescription>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <form className="grid gap-3 sm:grid-cols-3" onSubmit={saveVat}>
                  <Field id="vatNumber" label={t('vat.number')} error={fe['vatNumber']}><Input id="vatNumber" dir="ltr" inputMode="numeric" maxLength={15} placeholder="3XXXXXXXXXXXXX3" value={vat.vatNumber} onChange={(e) => { setVat({ ...vat, vatNumber: e.target.value }); }} disabled={!canVerify || Boolean(customer.vatNumberLockedAt)} /></Field>
                  <Field id="vatReason" label={t('vat.reason')} error={fe['reason']}><Input id="vatReason" value={vat.reason} onChange={(e) => { setVat({ ...vat, reason: e.target.value }); }} disabled={!canVerify || Boolean(customer.vatNumberLockedAt)} /></Field>
                  {canVerify && !customer.vatNumberLockedAt && (
                    <div className="flex items-end"><Button type="submit" variant="outline" disabled={busy !== null || vat.reason.trim().length < 5}>{busy === 'vat' ? <Loader2 className="animate-spin" /> : null}{t('vat.save')}</Button></div>
                  )}
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-4">
                <CardTitle className="text-base">{td('title')}</CardTitle>
                <CardDescription>{t('documents.hint')} · {td('pendingCount', { count: pendingDocs })}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 p-4 pt-0">
                {docs.length === 0 && <p className="text-sm text-muted-foreground">{t('documents.none')}</p>}
                {docs.map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{d.documentTypeCode}</div>
                      <div className="truncate text-xs text-muted-foreground">{d.originalFilename} · {d.expiryDate ?? '—'}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant={d.verificationStatus === 'VERIFIED' ? 'default' : d.verificationStatus === 'PENDING' ? 'secondary' : 'destructive'}>{d.verificationStatus}</Badge>
                      <Button size="sm" variant="ghost" onClick={() => void open(d)} aria-label={td('download')}><ExternalLink /></Button>
                      {canVerifyDocs && d.verificationStatus !== 'VERIFIED' && (
                        <>
                          <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => { verifyDoc(d, 'verify'); }}>{td('verify')}</Button>
                          <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => { verifyDoc(d, 'reject'); }}>{td('reject')}</Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {canVerify && !corp.isVerified && (
                  <div className="pt-2"><Button disabled={busy !== null} onClick={verifyCustomer}>{busy === 'verify' ? <Loader2 className="animate-spin" /> : <BadgeCheck className="size-4" />}{t('verifyCustomer')}</Button></div>
                )}
                {corp.isVerified && <p className="inline-flex items-center gap-1 text-sm text-muted-foreground"><BadgeCheck className="size-4" />{t('verified')}</p>}
              </CardContent>
            </Card>

            {credit && (
              <Card>
                <CardHeader className="p-4">
                  <CardTitle className="text-base">{t('creditPanel.title')}</CardTitle>
                  <CardDescription>{t('creditPanel.hint')}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-4 pt-0">
                  <div className="grid gap-2 text-sm sm:grid-cols-3" dir="ltr">
                    <div><span className="text-muted-foreground">{t('creditPanel.mode')}</span><div className="font-medium">{credit.defaultBillingMode === 'INVOICED' ? t('billingModes.INVOICED', { cycle: t(`cycles.${credit.billingCycle}` as 'cycles.MONTHLY') }) : t('billingModes.PREPAID')}</div></div>
                    <div><span className="text-muted-foreground">{t('creditPanel.outstanding')}</span><div className="font-medium">{credit.outstandingAmount} {credit.currency}</div></div>
                    <div><span className="text-muted-foreground">{t('creditPanel.available')}</span><div className="font-medium">{credit.availableAmount} {credit.currency}</div></div>
                  </div>
                  {canVerify && (
                    <form className="grid gap-3 sm:grid-cols-2" onSubmit={saveCredit}>
                      <Field id="creditStatus" label={t('creditPanel.status')} error={fe['creditStatus']}>
                        <select id="creditStatus" className={select} value={creditForm.creditStatus} onChange={(e) => { setCreditForm({ ...creditForm, creditStatus: e.target.value }); }}>
                          {CREDIT_STATUSES.map((s) => <option key={s} value={s}>{t(`creditStatuses.${s}`)}</option>)}
                        </select>
                      </Field>
                      <Field id="creditLimitAmount" label={t('creditPanel.limit')} error={fe['creditLimitAmount']}><Input id="creditLimitAmount" dir="ltr" inputMode="decimal" value={creditForm.creditLimitAmount} onChange={(e) => { setCreditForm({ ...creditForm, creditLimitAmount: e.target.value }); }} /></Field>
                      <Field id="creditCycle" label={t('corporate.billingCycle')} error={fe['billingCycle']}>
                        <select id="creditCycle" className={select} value={creditForm.billingCycle} onChange={(e) => { setCreditForm({ ...creditForm, billingCycle: e.target.value }); }}>
                          {BILLING_CYCLES.map((c) => <option key={c} value={c}>{t(`cycles.${c}`)}</option>)}
                        </select>
                      </Field>
                      <Field id="creditTerms" label={t('corporate.creditTermsDays')} error={fe['creditTermsDays']}><Input id="creditTerms" type="number" min={0} max={180} dir="ltr" value={creditForm.creditTermsDays} onChange={(e) => { setCreditForm({ ...creditForm, creditTermsDays: e.target.value }); }} /></Field>
                      <Field id="creditReason" label={t('creditPanel.reason')} error={fe['reason']} className="sm:col-span-2"><Input id="creditReason" value={creditForm.reason} onChange={(e) => { setCreditForm({ ...creditForm, reason: e.target.value }); }} /></Field>
                      <div className="sm:col-span-2"><Button type="submit" disabled={busy !== null}>{busy === 'credit' ? <Loader2 className="animate-spin" /> : null}{t('creditPanel.save')}</Button></div>
                    </form>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
