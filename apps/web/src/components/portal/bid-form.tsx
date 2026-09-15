'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { BidDto, OpportunityDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The owner's bid on an opportunity. Only the base fare, one optional extra and notes are typed;
 * VAT and the total are computed by the API and shown back on success.
 */
export function BidForm({ opportunity, open, onOpenChange, onSubmitted }: { opportunity: OpportunityDto; open: boolean; onOpenChange: (open: boolean) => void; onSubmitted: (bid: BidDto) => void }) {
  const t = useTranslations('portal.bids.form');
  const tc = useTranslations('common');
  const vehicles = opportunity.eligibleVehicles;
  const [vehicleId, setVehicleId] = useState(vehicles[0]?.id ?? '');
  const [baseAmount, setBaseAmount] = useState('');
  const [extraLabel, setExtraLabel] = useState('');
  const [extraAmount, setExtraAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const money = (v: string) => (/^\d+(\.\d{1,2})?$/.test(v.trim()) ? Number(v).toFixed(2) : null);
  const base = money(baseAmount);
  const extra = extraAmount.trim() ? money(extraAmount) : '0.00';
  const valid = Boolean(vehicleId) && base !== null && Number(base) > 0 && extra !== null && (!extraAmount.trim() || extraLabel.trim().length > 0);

  async function submit() {
    if (!valid) return; // aliased-condition narrowing: base and extra are strings past this point
    setBusy(true);
    setError(null);
    const body = {
      tripRequestId: opportunity.request.id,
      vehicleId,
      baseAmount: base,
      extrasBreakdown: extraAmount.trim() ? [{ labelEn: extraLabel.trim(), labelAr: extraLabel.trim(), amount: extra }] : [],
      ...(notes.trim() ? { ownerNotes: notes.trim() } : {}),
    };
    const res = await api<BidDto>('/bids', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSubmitted(res.data);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={tc('close')}>
        <DialogHeader>
          <DialogTitle dir="ltr">{t('title', { number: opportunity.request.requestNumber })}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="size-4" />
            <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
          </Alert>
        )}
        <div className="grid gap-3">
          <div className="space-y-1">
            <Label htmlFor="bid-vehicle">{t('vehicle')}</Label>
            <select id="bid-vehicle" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); }} dir="ltr">
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.plateNumberEn} · {v.categoryCode}{v.passengerCapacity ? ` · ${v.passengerCapacity}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bid-base">{t('baseAmount')}</Label>
            <Input id="bid-base" inputMode="decimal" dir="ltr" value={baseAmount} onChange={(e) => { setBaseAmount(e.target.value); }} placeholder="1250.00" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="bid-extra-label">{t('extraLabel')}</Label>
              <Input id="bid-extra-label" value={extraLabel} onChange={(e) => { setExtraLabel(e.target.value); }} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="bid-extra-amount">{t('extraAmount')}</Label>
              <Input id="bid-extra-amount" inputMode="decimal" dir="ltr" value={extraAmount} onChange={(e) => { setExtraAmount(e.target.value); }} placeholder="0.00" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="bid-notes">{t('notes')}</Label>
            <Input id="bid-notes" value={notes} onChange={(e) => { setNotes(e.target.value); }} />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={!valid || busy} onClick={() => void submit()}>
            {busy && <Loader2 className="animate-spin" />}
            {t('submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
