'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2, Trash2 } from 'lucide-react';
import type { CodedLabelDto, ExpenseDto, ExpenseSummaryDto, VehicleDto } from '@unigate/types';
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

/** Owner expenses (api.md §8.22): record, list, summary by category; rows inside a paid settlement period are locked. */
export function ExpensesPage() {
  const t = useTranslations('portal.finance.expenses');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { me, can } = useSession();
  const owner = Boolean(me?.profiles.owner);
  const [rows, setRows] = useState<ExpenseDto[] | null>(null);
  const [summary, setSummary] = useState<ExpenseSummaryDto | null>(null);
  const [categories, setCategories] = useState<CodedLabelDto[]>([]);
  const [vehicles, setVehicles] = useState<VehicleDto[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ expenseCategoryId: '', amount: '', vatAmount: '0.00', expenseDate: today, vehicleId: '', vendorName: '', description: '', isReimbursable: false });

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([api<ExpenseDto[]>('/expenses', { query: { pageSize: 100 } }), api<ExpenseSummaryDto>('/expenses/summary', { query: { groupBy: 'category' } })]);
    if (a.ok) setRows(a.data);
    else setError(a.error);
    if (b.ok) setSummary(b.data);
  }, []);
  useEffect(() => {
    void load();
    void api<CodedLabelDto[]>('/reference/expense-categories').then((res) => {
      if (res.ok) {
        setCategories(res.data);
        setForm((f) => ({ ...f, expenseCategoryId: f.expenseCategoryId || (res.data[0]?.id ?? '') }));
      }
    });
    if (owner) {
      void api<VehicleDto[]>('/vehicles', { query: { pageSize: 100 } }).then((res) => {
        if (res.ok) setVehicles(res.data);
      });
    }
  }, [load, owner]);

  async function submit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { expenseCategoryId: form.expenseCategoryId, amount: form.amount, vatAmount: form.vatAmount || '0.00', expenseDate: form.expenseDate, ...(form.vehicleId ? { vehicleId: form.vehicleId } : {}), ...(form.vendorName ? { vendorName: form.vendorName } : {}), ...(form.description ? { description: form.description } : {}), isReimbursable: form.isReimbursable };
    const res = await api<ExpenseDto>('/expenses', { method: 'POST', body });
    setBusy(false);
    if (res.ok) {
      setForm((f) => ({ ...f, amount: '', vatAmount: '0.00', vendorName: '', description: '' }));
      await load();
    } else setError(res.error);
  }
  async function remove(id: string) {
    setBusy(true);
    const res = await api(`/expenses/${id}`, { method: 'DELETE' });
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
      {summary && summary.rows.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-4">
          {summary.rows.map((r) => (
            <div key={r.key} className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">{r.label ?? r.key} · {r.count}</div>
              <div className="font-medium" dir="ltr">{r.totalAmount} {summary.currency}</div>
            </div>
          ))}
          <div className="rounded-md border bg-muted/40 p-3">
            <div className="text-xs text-muted-foreground">{t('total')}</div>
            <div className="font-medium" dir="ltr">{summary.totals.totalAmount} {summary.currency}</div>
          </div>
        </div>
      )}
      {owner && can('expenses.create') && (
        <Card>
          <CardHeader><CardTitle className="text-base">{t('record')}</CardTitle></CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-3" onSubmit={(e) => void submit(e)}>
              <div className="space-y-1">
                <Label htmlFor="ex-cat">{t('category')}</Label>
                <select id="ex-cat" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={form.expenseCategoryId} onChange={(e) => { setForm({ ...form, expenseCategoryId: e.target.value }); }}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{locale === 'ar' ? c.nameAr : c.nameEn}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ex-amount">{t('amount')}</Label>
                <Input id="ex-amount" dir="ltr" placeholder="250.00" required value={form.amount} onChange={(e) => { setForm({ ...form, amount: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ex-vat">{t('vat')}</Label>
                <Input id="ex-vat" dir="ltr" value={form.vatAmount} onChange={(e) => { setForm({ ...form, vatAmount: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ex-date">{t('date')}</Label>
                <Input id="ex-date" type="date" required value={form.expenseDate} onChange={(e) => { setForm({ ...form, expenseDate: e.target.value }); }} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ex-vehicle">{t('vehicle')}</Label>
                <select id="ex-vehicle" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={form.vehicleId} onChange={(e) => { setForm({ ...form, vehicleId: e.target.value }); }}>
                  <option value="">—</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.plateNumberEn}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="ex-vendor">{t('vendor')}</Label>
                <Input id="ex-vendor" value={form.vendorName} onChange={(e) => { setForm({ ...form, vendorName: e.target.value }); }} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="ex-desc">{t('description')}</Label>
                <Input id="ex-desc" value={form.description} onChange={(e) => { setForm({ ...form, description: e.target.value }); }} />
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.isReimbursable} onChange={(e) => { setForm({ ...form, isReimbursable: e.target.checked }); }} />
                  {t('reimbursable')}
                </label>
                <Button type="submit" disabled={busy || !form.amount || !form.expenseCategoryId}>
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
                <TableHead>{t('date')}</TableHead>
                <TableHead>{t('category')}</TableHead>
                <TableHead>{t('vehicle')}</TableHead>
                <TableHead>{t('description')}</TableHead>
                <TableHead>{t('total')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows === null ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground"><Loader2 className="inline size-4 animate-spin" /></TableCell></TableRow>
              ) : rows.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{t('empty')}</TableCell></TableRow>
              ) : (
                rows.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-sm">{e.expenseDate}</TableCell>
                    <TableCell><Badge variant="outline">{e.categoryCode}</Badge></TableCell>
                    <TableCell dir="ltr">{e.vehiclePlate ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{[e.vendorName, e.description].filter(Boolean).join(' · ')}</TableCell>
                    <TableCell dir="ltr">{e.totalAmount} {e.currency}</TableCell>
                    <TableCell className="text-end">
                      {e.isLocked ? <span className="text-xs text-muted-foreground">{t('locked')}</span> : can('expenses.delete') && (
                        <Button variant="ghost" size="sm" aria-label={t('remove')} disabled={busy} onClick={() => void remove(e.id)}><Trash2 className="size-4" /></Button>
                      )}
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
