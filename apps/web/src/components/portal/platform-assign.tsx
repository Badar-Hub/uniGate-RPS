'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AcceptBidResultDto, OwnerDto, TripRequestDto, VehicleDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * A-57: ops put one of UniGate's own vehicles on a request without a bid. Lists the platform
 * fleet's vehicles in the request's category and calls POST /trip-requests/{id}/assign-platform-vehicle.
 */
export function PlatformAssign({ request, onChanged }: { request: TripRequestDto; onChanged: (r: TripRequestDto) => void }) {
  const t = useTranslations('portal.requests.platformAssign');
  const tc = useTranslations('common');
  const [vehicles, setVehicles] = useState<VehicleDto[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [baseAmount, setBaseAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    void api<OwnerDto[]>('/owners', { query: { pageSize: 100 } }).then(async (res) => {
      const platform = res.ok ? res.data.find((o) => o.isPlatformFleet) : undefined;
      if (!platform) return;
      const v = await api<VehicleDto[]>('/vehicles', { query: { ownerProfileId: platform.id, pageSize: 100 } });
      if (v.ok) setVehicles(v.data.filter((x) => x.category.id === request.vehicleCategory?.id && x.approvalStatus === 'APPROVED'));
    });
  }, [request.vehicleCategory?.id]);

  // Ops type a plain amount ("50000", "1,250.5"); the API wants a 2-decimal string.
  const amount = Number(baseAmount.replace(/[,\s]/g, ''));
  const amountOk = baseAmount.trim() !== '' && Number.isFinite(amount) && amount > 0;
  async function assign() {
    setBusy(true);
    setError(null);
    const res = await api<AcceptBidResultDto>(`/trip-requests/${request.id}/assign-platform-vehicle`, { method: 'POST', body: { vehicleId, baseAmount: amount.toFixed(2) }, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (res.ok) {
      setBaseAmount('');
      onChanged(res.data.tripRequest);
    } else setError(res.error);
  }

  if (!vehicles.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('title')}</CardTitle>
        <CardDescription>{t('hint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <Alert variant="destructive"><AlertCircle className="size-4" /><AlertDescription>{errorMessage(tc, error)}</AlertDescription></Alert>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="pa-vehicle">{t('vehicle')}</Label>
            <select id="pa-vehicle" className="flex h-9 min-w-48 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm" value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); }}>
              <option value="">—</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.plateNumberEn}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="pa-amount">{t('baseAmount')}</Label>
            <Input id="pa-amount" dir="ltr" inputMode="decimal" placeholder="1000.00" value={baseAmount} onChange={(e) => { setBaseAmount(e.target.value); }} />
          </div>
          <Button disabled={busy || !vehicleId || !amountOk} onClick={() => void assign()}>
            {busy && <Loader2 className="animate-spin" />}
            {t('assign')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
