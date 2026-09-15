'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, FileText, Loader2 } from 'lucide-react';
import type { CustomerStatementDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Accounts-receivable statement for a customer (api.md §8.4): ledger-derived balances, invoices and movements in the period, ageing. */
export function CustomerStatement({ customerProfileId }: { customerProfileId: string }) {
  const t = useTranslations('portal.statement');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [period, setPeriod] = useState({ periodStart: day(new Date(new Date().getFullYear(), new Date().getMonth(), 1)), periodEnd: day(new Date()) });
  const [st, setSt] = useState<CustomerStatementDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    const res = await api<CustomerStatementDto>(`/customers/${customerProfileId}/statement`, { query: period });
    setBusy(false);
    if (res.ok) setSt(res.data);
    else setError(res.error);
  }
  const fmt = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{t('title')}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="st-from">{t('from')}</Label><Input id="st-from" type="date" value={period.periodStart} onChange={(e) => { setPeriod({ ...period, periodStart: e.target.value }); }} /></div>
          <div className="space-y-1"><Label htmlFor="st-to">{t('to')}</Label><Input id="st-to" type="date" value={period.periodEnd} onChange={(e) => { setPeriod({ ...period, periodEnd: e.target.value }); }} /></div>
          <Button variant="outline" disabled={busy} onClick={() => void load()}>{busy ? <Loader2 className="animate-spin" /> : <FileText className="size-4" />}{t('generate')}</Button>
        </div>
        {error && (
          <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
        )}
        {st && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-5 text-sm">
              {([['openingBalance', st.openingBalance], ['invoicedAmount', st.invoicedAmount], ['paymentsAmount', st.paymentsAmount], ['creditsAmount', st.creditsAmount], ['closingBalance', st.closingBalance]] as const).map(([k, v]) => (
                <div key={k} className="rounded-md border p-2"><div className="text-xs text-muted-foreground">{t(k)}</div><div className="font-medium" dir="ltr">{v} {st.currency}</div></div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-5 text-xs">
              {([['current', st.ageing.current], ['d1to30', st.ageing.d1to30], ['d31to60', st.ageing.d31to60], ['d61to90', st.ageing.d61to90], ['over90', st.ageing.over90]] as const).map(([k, v]) => (
                <div key={k} className="rounded-md border bg-muted/30 p-2"><div className="text-muted-foreground">{t(`ageing.${k}`)}</div><div dir="ltr">{v}</div></div>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-muted-foreground"><th className="py-1 text-start">{t('date')}</th><th className="py-1 text-start">{t('description')}</th><th className="py-1 text-start">{t('reference')}</th><th className="py-1 text-end">{t('debit')}</th><th className="py-1 text-end">{t('credit')}</th></tr></thead>
                <tbody>
                  {st.movements.length === 0 ? (
                    <tr><td colSpan={5} className="py-4 text-center text-muted-foreground">{t('noMovements')}</td></tr>
                  ) : (
                    st.movements.map((m, i) => (
                      <tr key={i} className="border-t"><td className="py-1" dir="ltr">{fmt(m.occurredAt)}</td><td className="py-1">{m.description}</td><td className="py-1" dir="ltr">{m.reference ?? '—'}</td><td className="py-1 text-end" dir="ltr">{m.debit}</td><td className="py-1 text-end" dir="ltr">{m.credit}</td></tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
