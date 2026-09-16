'use client';

import { useEffect, useState, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { CityDto, OwnerDto, VehicleCategoryDto, VehicleDto, VehicleMakeDto, VehicleModelDto } from '@unigate/types';
import { api, type ApiError } from '@/lib/api-client';
import { useSession } from '@/lib/auth/session-provider';
import { errorMessage, fieldErrors, unmappedFieldErrors } from '@/lib/errors';
import { useRouter } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const NONE = '__none__';

/** Hoisted so React keeps the inputs mounted between renders (an inline component type remounts on every keystroke). */
function Field({ id, label, error, children }: { id: string; label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Registration form. Capacity fields follow the category's vertical; the API re-validates everything. */
export function VehicleForm() {
  const t = useTranslations('portal.fleet.form');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const { me, can } = useSession();
  // Staff without an owner profile register on behalf of a vendor (api.md §8.8: ownerProfileId is admin-only).
  const onBehalf = !me?.profiles.owner && can('vehicles.create') && can('owners.read');
  const [owners, setOwners] = useState<OwnerDto[]>([]);
  const [ownerProfileId, setOwnerProfileId] = useState('');
  const [categories, setCategories] = useState<VehicleCategoryDto[]>([]);
  const [makes, setMakes] = useState<VehicleMakeDto[]>([]);
  const [models, setModels] = useState<VehicleModelDto[]>([]);
  const [cities, setCities] = useState<CityDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState({
    vehicleCategoryId: '', vehicleMakeId: NONE, vehicleModelId: NONE, modelYear: String(new Date().getFullYear()), plateNumberEn: '', plateNumberAr: '', registrationNumber: '', vin: '', colorCode: '',
    passengerCapacity: '', payloadCapacityKg: '', baseCityId: NONE, insuranceExpiryDate: '', registrationExpiryDate: '', inspectionExpiryDate: '',
  });
  const fe = fieldErrors(error);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const category = categories.find((c) => c.id === form.vehicleCategoryId);

  useEffect(() => {
    void api<VehicleCategoryDto[]>('/vehicle-categories').then((r) => {
      if (r.ok) setCategories(r.data);
    });
    void api<VehicleMakeDto[]>('/reference/vehicle-makes').then((r) => {
      if (r.ok) setMakes(r.data);
    });
    void api<CityDto[]>('/reference/cities').then((r) => {
      if (r.ok) setCities(r.data);
    });
  }, []);
  useEffect(() => {
    if (!onBehalf) return;
    void api<OwnerDto[]>('/owners', { query: { pageSize: 100, onboardingStatus: 'APPROVED' } }).then((r) => {
      if (!r.ok) return;
      // UniGate's own fleet first and preselected; vendors follow.
      const sorted = [...r.data].sort((x, y) => Number(y.isPlatformFleet) - Number(x.isPlatformFleet));
      setOwners(sorted);
      setOwnerProfileId((cur) => cur || (sorted[0]?.id ?? ''));
    });
  }, [onBehalf]);
  useEffect(() => {
    if (form.vehicleMakeId === NONE) {
      setModels([]);
      return;
    }
    void api<VehicleModelDto[]>('/reference/vehicle-models', { query: { makeId: form.vehicleMakeId } }).then((r) => {
      if (r.ok) setModels(r.data);
    });
  }, [form.vehicleMakeId]);

  async function onSubmit(e: SyntheticEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      ...(onBehalf && ownerProfileId ? { ownerProfileId } : {}),
      vehicleCategoryId: form.vehicleCategoryId,
      modelYear: Number(form.modelYear),
      plateNumberEn: form.plateNumberEn.trim(),
      registrationNumber: form.registrationNumber.trim(),
      colorCode: form.colorCode.trim(),
      ...(form.vehicleMakeId !== NONE ? { vehicleMakeId: form.vehicleMakeId } : {}),
      ...(form.vehicleModelId !== NONE ? { vehicleModelId: form.vehicleModelId } : {}),
      ...(form.plateNumberAr.trim() ? { plateNumberAr: form.plateNumberAr.trim() } : {}),
      ...(form.vin.trim() ? { vin: form.vin.trim() } : {}),
      ...(form.passengerCapacity ? { passengerCapacity: Number(form.passengerCapacity) } : {}),
      ...(form.payloadCapacityKg ? { payloadCapacityKg: Number(form.payloadCapacityKg) } : {}),
      ...(form.baseCityId !== NONE ? { baseCityId: form.baseCityId } : {}),
      ...(form.insuranceExpiryDate ? { insuranceExpiryDate: form.insuranceExpiryDate } : {}),
      ...(form.registrationExpiryDate ? { registrationExpiryDate: form.registrationExpiryDate } : {}),
      ...(form.inspectionExpiryDate ? { inspectionExpiryDate: form.inspectionExpiryDate } : {}),
    };
    const res = await api<VehicleDto>('/vehicles', { method: 'POST', body });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/fleet/${res.data.id}?created=1`);
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4 md:grid-cols-2">
          {error && (
            <Alert variant="destructive" className="md:col-span-2">
              <AlertCircle className="size-4" />
              <AlertDescription>{errorMessage(tc, error)}{unmappedFieldErrors(error, [...Object.keys(form), 'ownerProfileId']) ? ` — ${unmappedFieldErrors(error, [...Object.keys(form), 'ownerProfileId'])}` : ''}</AlertDescription>
            </Alert>
          )}
          {onBehalf && (
            <Field id="ownerProfileId" label={t('owner')} error={fe['ownerProfileId']}>
              <Select value={ownerProfileId} onValueChange={setOwnerProfileId} required>
                <SelectTrigger id="ownerProfileId">
                  <SelectValue placeholder={t('ownerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {owners.map((o) => (
                    <SelectItem key={o.id} value={o.id}>{o.isPlatformFleet ? t('platformFleet') : ((locale === 'ar' ? o.businessNameAr : o.businessNameEn) ?? o.businessNameEn ?? o.id.slice(0, 8))}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field id="vehicleCategoryId" label={t('category')} error={fe['vehicleCategoryId']}>
            <Select value={form.vehicleCategoryId} onValueChange={set('vehicleCategoryId')} required>
              <SelectTrigger id="vehicleCategoryId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {locale === 'ar' ? c.nameAr : c.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="modelYear" label={t('modelYear')} error={fe['modelYear']}>
            <Input id="modelYear" type="number" min={1980} max={new Date().getFullYear() + 2} value={form.modelYear} onChange={(e) => { set('modelYear')(e.target.value); }} required dir="ltr" />
          </Field>
          <Field id="vehicleMakeId" label={t('make')} error={fe['vehicleMakeId']}>
            <Select value={form.vehicleMakeId} onValueChange={(v) => { setForm((f) => ({ ...f, vehicleMakeId: v, vehicleModelId: NONE })); }}>
              <SelectTrigger id="vehicleMakeId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('noMake')}</SelectItem>
                {makes.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="vehicleModelId" label={t('model')} error={fe['vehicleModelId']}>
            <Select value={form.vehicleModelId} onValueChange={set('vehicleModelId')} disabled={models.length === 0}>
              <SelectTrigger id="vehicleModelId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('noMake')}</SelectItem>
                {models.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="plateNumberEn" label={t('plateEn')} error={fe['plateNumberEn']}>
            <Input id="plateNumberEn" placeholder="1234 ABC" value={form.plateNumberEn} onChange={(e) => { set('plateNumberEn')(e.target.value); }} required dir="ltr" />
          </Field>
          <Field id="plateNumberAr" label={t('plateAr')} error={fe['plateNumberAr']}>
            <Input id="plateNumberAr" value={form.plateNumberAr} onChange={(e) => { set('plateNumberAr')(e.target.value); }} dir="rtl" />
          </Field>
          <Field id="registrationNumber" label={t('registrationNumber')} error={fe['registrationNumber']}>
            <Input id="registrationNumber" value={form.registrationNumber} onChange={(e) => { set('registrationNumber')(e.target.value); }} required dir="ltr" />
          </Field>
          <Field id="vin" label={t('vin')} error={fe['vin']}>
            <Input id="vin" maxLength={17} value={form.vin} onChange={(e) => { set('vin')(e.target.value.toUpperCase()); }} dir="ltr" />
          </Field>
          <Field id="colorCode" label={t('colour')} error={fe['colorCode']}>
            <Input id="colorCode" value={form.colorCode} onChange={(e) => { set('colorCode')(e.target.value); }} required />
          </Field>
          {category?.transportType === 'GOODS' ? (
            <Field id="payloadCapacityKg" label={t('payloadKg')} error={fe['payloadCapacityKg']}>
              <Input id="payloadCapacityKg" type="number" min={1} value={form.payloadCapacityKg} onChange={(e) => { set('payloadCapacityKg')(e.target.value); }} required dir="ltr" />
            </Field>
          ) : (
            <Field id="passengerCapacity" label={t('passengerCapacity')} error={fe['passengerCapacity']}>
              <Input id="passengerCapacity" type="number" min={1} max={100} value={form.passengerCapacity} onChange={(e) => { set('passengerCapacity')(e.target.value); }} required dir="ltr" />
            </Field>
          )}
          <Field id="baseCityId" label={t('baseCity')} error={fe['baseCityId']}>
            <Select value={form.baseCityId} onValueChange={set('baseCityId')}>
              <SelectTrigger id="baseCityId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('noMake')}</SelectItem>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {locale === 'ar' ? c.nameAr : c.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="insuranceExpiryDate" label={t('insuranceExpiry')} error={fe['insuranceExpiryDate']}>
            <Input id="insuranceExpiryDate" type="date" value={form.insuranceExpiryDate} onChange={(e) => { set('insuranceExpiryDate')(e.target.value); }} />
          </Field>
          <Field id="registrationExpiryDate" label={t('registrationExpiry')} error={fe['registrationExpiryDate']}>
            <Input id="registrationExpiryDate" type="date" value={form.registrationExpiryDate} onChange={(e) => { set('registrationExpiryDate')(e.target.value); }} />
          </Field>
          <Field id="inspectionExpiryDate" label={t('inspectionExpiry')} error={fe['inspectionExpiryDate']}>
            <Input id="inspectionExpiryDate" type="date" value={form.inspectionExpiryDate} onChange={(e) => { set('inspectionExpiryDate')(e.target.value); }} />
          </Field>
          <div className="md:col-span-2">
            <Button type="submit" disabled={busy || !form.vehicleCategoryId}>
              {busy && <Loader2 className="animate-spin" />}
              {t('submit')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
