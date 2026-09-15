'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { CommissionEarningsDto, CommissionRuleDto, VehicleCategoryDto } from '@unigate/types';
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

/**
 * Commission rules (api.md §8.20) for finance: the rule table (one active GLOBAL rule always
 * exists), a create form for GLOBAL / VEHICLE_CATEGORY rules, deactivate, and the platform
 * earnings roll-up. Owners reach their own earnings from the settlements page.
 */
export function CommissionRulesPage() {
  const t = useTranslations('portal.finance.commissions');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { can } = useSession();
  const [rows, setRows] = useState<CommissionRuleDto[] | null>(null);
  const [categories, setCategories] = useState<VehicleCategoryDto[]>([]);
  const [earnings, setEarnings] = useState<CommissionEarningsDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', scope: 'VEHICLE_CATEGORY', vehicleCategoryId: '', calculationType: 'PERCENTAGE', percentageRate: '10.00', fixedAmount: '', basis: 'NET_OF_VAT', priority: '10' });

  const load = useCallback(async () => {
    const res = await api<CommissionRuleDto[]>('/commissions/rules', { query: { pageSize: 100 } });
    if (res.ok) setRows(res.data);
    else setError(res.error);
    if (can('reports.financial.read')) {
      const e = await api<CommissionEarningsDto>('/commissions/earnings', { query: { groupBy: 'month' } });
      if (e.ok) setEarnings(e.data);
    }
  }, [can]);
  useEffect(() => {
    void load();
    void api<VehicleCategoryDto[]>('/vehicle-categories').then((res) => {
      if (res.ok) {
        setCategories(res.data);
        setForm((f) => ({ ...f, vehicleCategoryId: f.vehicleCategoryId || (res.data[0]?.id ?? '') }));
      }
    });
  }, [load]);

  async function create(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      name: form.name, scope: form.scope, calculationType: form.calculationType, basis: form.basis, priority: Number(form.priority),
      ...(form.scope === 'VEHICLE_CATEGORY' ? { vehicleCategoryId: form.vehicleCategoryId } : {}),
      ...(form.calculationType === 'PERCENTAGE' ? { percentageRate: form.percentageRate } : {}),
      ...(form.calculationType === 'FIXED' ? { fixedAmount: form.fixedAmount } : {}),
    };
    const res = await api<CommissionRuleDto>('/commissions/rules', { method: 'POST', body });
    setBusy(false);
    if (res.ok) {
      setForm((f) => ({ ...f, name: '' }));
      await load();
    } else setError(res.error);
  }
  async function deactivate(id: string) {
    setBusy(true);
    setError(null);
    const res = await api(`/commissions/rules/${id}`, { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) setError(res.error);
    await load();
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
      {earnings && (
        <div className="grid gap-2 sm:grid-cols-4">
          <Stat label={t('bookings')} value={String(earnings.totals.bookingCount)} />
          <Stat label={t('gross')} value={`${earnings.totals.grossAmount} ${earnings.currency}`} />
          <Stat label={t('commission')} value={`${earnings.totals.commissionAmount} ${earnings.currency}`} />
          <Stat label={t('ownerNet')} value={`${earnings.totals.ownerNetAmount} ${earnings.currency}`} />
        </div>
      )}
      {can('commissions.manage') && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('create')}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => void create(e)}>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="cr-name">{t('name')}</Label>
                <Input id="cr-name" required value={form.name} onChange={(e) => { setForm({ ...form, name: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cr-scope">{t('scope')}</Label>
                <select id="cr-scope" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={form.scope} onChange={(e) => { setForm({ ...form, scope: e.target.value }); }}>
                  <option value="VEHICLE_CATEGORY">{t('scopes.VEHICLE_CATEGORY')}</option>
                  <option value="GLOBAL">{t('scopes.GLOBAL')}</option>
                </select>
              </div>
              {form.scope === 'VEHICLE_CATEGORY' && (
                <div className="space-y-1">
                  <Label htmlFor="cr-cat">{t('category')}</Label>
                  <select id="cr-cat" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={form.vehicleCategoryId} onChange={(e) => { setForm({ ...form, vehicleCategoryId: e.target.value }); }}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{locale === 'ar' ? c.nameAr : c.nameEn}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="cr-type">{t('type')}</Label>
                <select id="cr-type" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={form.calculationType} onChange={(e) => { setForm({ ...form, calculationType: e.target.value }); }}>
                  <option value="PERCENTAGE">{t('types.PERCENTAGE')}</option>
                  <option value="FIXED">{t('types.FIXED')}</option>
                  <option value="NONE">{t('types.NONE')}</option>
                </select>
              </div>
              {form.calculationType === 'PERCENTAGE' && (
                <div className="space-y-1">
                  <Label htmlFor="cr-pct">{t('percent')}</Label>
                  <Input id="cr-pct" dir="ltr" value={form.percentageRate} onChange={(e) => { setForm({ ...form, percentageRate: e.target.value }); }} />
                </div>
              )}
              {form.calculationType === 'FIXED' && (
                <div className="space-y-1">
                  <Label htmlFor="cr-fixed">{t('fixed')}</Label>
                  <Input id="cr-fixed" dir="ltr" value={form.fixedAmount} onChange={(e) => { setForm({ ...form, fixedAmount: e.target.value }); }} />
                </div>
              )}
              <div className="space-y-1">
                <Label htmlFor="cr-basis">{t('basis')}</Label>
                <select id="cr-basis" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={form.basis} onChange={(e) => { setForm({ ...form, basis: e.target.value }); }}>
                  <option value="NET_OF_VAT">{t('bases.NET_OF_VAT')}</option>
                  <option value="GROSS">{t('bases.GROSS')}</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cr-prio">{t('priority')}</Label>
                <Input id="cr-prio" dir="ltr" type="number" min={0} max={1000} value={form.priority} onChange={(e) => { setForm({ ...form, priority: e.target.value }); }} />
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={busy || form.name.length < 2}>
                  {busy && <Loader2 className="animate-spin" />}
                  {t('save')}
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
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('scope')}</TableHead>
                <TableHead>{t('rate')}</TableHead>
                <TableHead>{t('basis')}</TableHead>
                <TableHead>{t('priority')}</TableHead>
                <TableHead>{t('statusLabel')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-sm">{t(`scopes.${r.scope}` as 'scopes.GLOBAL')}</TableCell>
                    <TableCell dir="ltr">{r.calculationType === 'PERCENTAGE' ? `${r.percentageRate} %` : r.calculationType === 'FIXED' ? `${r.fixedAmount} ${r.currency}` : t('types.NONE')}</TableCell>
                    <TableCell className="text-sm">{t(`bases.${r.basis}` as 'bases.GROSS')}</TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell><Badge variant={r.isActive ? 'default' : 'outline'}>{r.isActive ? t('active') : t('inactive')}</Badge></TableCell>
                    <TableCell className="text-end">
                      {r.isActive && can('commissions.manage') && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void deactivate(r.id)}>{t('deactivate')}</Button>}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-medium" dir="ltr">{value}</div>
    </div>
  );
}
