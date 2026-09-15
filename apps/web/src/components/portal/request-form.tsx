'use client';

import { useEffect, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { CityDto, SavedLocationDto, TripRequestDto, VehicleCategoryDto } from '@unigate/types';
import { api, idempotencyKey, type ApiError } from '@/lib/api-client';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { useRouter } from '@/lib/i18n/routing';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const PURPOSES = ['AIRPORT_TRANSFER', 'INTERCITY', 'CITY_TOUR', 'EMPLOYEE_TRANSPORT', 'HAJJ_UMRAH', 'EVENT', 'OTHER'] as const;

function Field({ id, label, error, children, className }: { id: string; label: string; error?: string | undefined; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-2 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** New passenger request. City centre coordinates are used when the customer types an address — maps autocomplete lands with the provider key. */
export function RequestForm() {
  const t = useTranslations('portal.requests.form');
  const tp = useTranslations('portal.requests.purpose');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [categories, setCategories] = useState<VehicleCategoryDto[]>([]);
  const [cities, setCities] = useState<CityDto[]>([]);
  const [saved, setSaved] = useState<SavedLocationDto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [form, setForm] = useState({
    vehicleCategoryId: '', vehiclesRequired: '1', allowPartialFulfilment: 'no', tripDirection: 'ONE_WAY', pickupAddress: '', pickupCityId: '', dropoffAddress: '', dropoffCityId: '',
    pickupAt: '', returnAt: '', passengerCount: '1', luggageCount: '0', tripPurpose: 'AIRPORT_TRANSFER', wheelchair: false, femaleDriver: false, childSeats: '0', budget: '', instructions: '',
  });
  const fe = fieldErrors(error);
  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
  };

  useEffect(() => {
    void api<VehicleCategoryDto[]>('/vehicle-categories', { query: { transportType: 'PASSENGER' } }).then((r) => {
      if (r.ok) setCategories(r.data);
    });
    void api<CityDto[]>('/reference/cities').then((r) => {
      if (r.ok) setCities(r.data);
    });
    void api<SavedLocationDto[]>('/me/saved-locations').then((r) => {
      if (r.ok) setSaved(r.data);
    });
  }, []);

  function applySaved(which: 'pickup' | 'dropoff', id: string) {
    const s = saved.find((x) => x.id === id);
    if (!s) return;
    setForm((f) => (which === 'pickup' ? { ...f, pickupAddress: s.addressLine, pickupCityId: s.cityId } : { ...f, dropoffAddress: s.addressLine, dropoffCityId: s.cityId }));
  }

  async function submit(publish: boolean) {
    setBusy(true);
    setError(null);
    const pc = cities.find((c) => c.id === form.pickupCityId);
    const dc = cities.find((c) => c.id === form.dropoffCityId);
    const sp = saved.find((s) => s.addressLine === form.pickupAddress && s.cityId === form.pickupCityId);
    const sd = saved.find((s) => s.addressLine === form.dropoffAddress && s.cityId === form.dropoffCityId);
    const body = {
      transportType: 'PASSENGER',
      vehicleCategoryId: form.vehicleCategoryId,
      vehiclesRequired: Number(form.vehiclesRequired),
      ...(Number(form.vehiclesRequired) > 1 ? { allowPartialFulfilment: form.allowPartialFulfilment === 'yes' } : {}),
      tripDirection: form.tripDirection,
      pickup: { addressLine: form.pickupAddress, cityId: form.pickupCityId, latitude: sp?.latitude ?? pc?.latitude ?? 0, longitude: sp?.longitude ?? pc?.longitude ?? 0 },
      dropoff: { addressLine: form.dropoffAddress, cityId: form.dropoffCityId, latitude: sd?.latitude ?? dc?.latitude ?? 0, longitude: sd?.longitude ?? dc?.longitude ?? 0 },
      pickupAt: new Date(form.pickupAt).toISOString(),
      ...(form.tripDirection === 'ROUND_TRIP' && form.returnAt ? { returnAt: new Date(form.returnAt).toISOString() } : {}),
      ...(form.budget ? { budgetAmount: Number(form.budget).toFixed(2) } : {}),
      ...(form.instructions.trim() ? { specialInstructions: form.instructions.trim() } : {}),
      passengerDetails: {
        passengerCount: Number(form.passengerCount), luggageCount: Number(form.luggageCount), tripPurpose: form.tripPurpose,
        requiresWheelchairAccess: form.wheelchair, requiresFemaleDriver: form.femaleDriver, childSeatsRequired: Number(form.childSeats),
      },
      publish,
    };
    const res = await api<TripRequestDto>('/trip-requests', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/requests/${res.data.id}?created=${publish ? 'published' : 'draft'}`);
  }

  const multi = Number(form.vehiclesRequired) > 1;

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e: SyntheticEvent) => {
            e.preventDefault();
            void submit(true);
          }}
          className="grid gap-4 md:grid-cols-2"
        >
          {error && (
            <Alert variant="destructive" className="md:col-span-2">
              <AlertCircle className="size-4" />
              <AlertDescription>{errorMessage(tc, error)}</AlertDescription>
            </Alert>
          )}
          <Field id="vehicleCategoryId" label={t('category')} error={fe['vehicleCategoryId']}>
            <Select value={form.vehicleCategoryId} onValueChange={set('vehicleCategoryId')}>
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
          <Field id="vehiclesRequired" label={t('vehiclesRequired')} error={fe['vehiclesRequired']}>
            <Input id="vehiclesRequired" type="number" min={1} max={200} value={form.vehiclesRequired} onChange={(e) => { set('vehiclesRequired')(e.target.value); }} required dir="ltr" />
          </Field>
          {multi && (
            <Field id="allowPartialFulfilment" label={t('partial')} className="md:col-span-2">
              <Select value={form.allowPartialFulfilment} onValueChange={set('allowPartialFulfilment')}>
                <SelectTrigger id="allowPartialFulfilment">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="no">{t('partialNo')}</SelectItem>
                  <SelectItem value="yes">{t('partialYes')}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field id="tripDirection" label={t('direction')}>
            <Select value={form.tripDirection} onValueChange={set('tripDirection')}>
              <SelectTrigger id="tripDirection">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ONE_WAY">{t('oneWay')}</SelectItem>
                <SelectItem value="ROUND_TRIP">{t('roundTrip')}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field id="tripPurpose" label={t('purpose')}>
            <Select value={form.tripPurpose} onValueChange={set('tripPurpose')}>
              <SelectTrigger id="tripPurpose">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PURPOSES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {tp(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {saved.length > 0 && (
            <Field id="savedPickup" label={t('savedLocation')}>
              <Select onValueChange={(v) => { applySaved('pickup', v); }}>
                <SelectTrigger id="savedPickup">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {saved.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field id="pickupAddress" label={t('pickupAddress')} error={fe['pickup.addressLine']} className={saved.length ? '' : 'md:col-span-2'}>
            <Input id="pickupAddress" value={form.pickupAddress} onChange={(e) => { set('pickupAddress')(e.target.value); }} required />
          </Field>
          <Field id="pickupCityId" label={t('pickupCity')} error={fe['pickup.cityId']}>
            <Select value={form.pickupCityId} onValueChange={set('pickupCityId')}>
              <SelectTrigger id="pickupCityId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {locale === 'ar' ? c.nameAr : c.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="pickupAt" label={t('pickupAt')} error={fe['pickupAt']}>
            <Input id="pickupAt" type="datetime-local" value={form.pickupAt} onChange={(e) => { set('pickupAt')(e.target.value); }} required dir="ltr" />
          </Field>
          <Field id="dropoffAddress" label={t('dropoffAddress')} error={fe['dropoff.addressLine']}>
            <Input id="dropoffAddress" value={form.dropoffAddress} onChange={(e) => { set('dropoffAddress')(e.target.value); }} required />
          </Field>
          <Field id="dropoffCityId" label={t('dropoffCity')} error={fe['dropoff.cityId']}>
            <Select value={form.dropoffCityId} onValueChange={set('dropoffCityId')}>
              <SelectTrigger id="dropoffCityId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cities.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {locale === 'ar' ? c.nameAr : c.nameEn}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {form.tripDirection === 'ROUND_TRIP' && (
            <Field id="returnAt" label={t('returnAt')} error={fe['returnAt']}>
              <Input id="returnAt" type="datetime-local" value={form.returnAt} onChange={(e) => { set('returnAt')(e.target.value); }} required dir="ltr" />
            </Field>
          )}
          <Field id="passengerCount" label={t('passengers')} error={fe['passengerDetails']}>
            <Input id="passengerCount" type="number" min={1} max={500} value={form.passengerCount} onChange={(e) => { set('passengerCount')(e.target.value); }} required dir="ltr" />
          </Field>
          <Field id="luggageCount" label={t('luggage')}>
            <Input id="luggageCount" type="number" min={0} value={form.luggageCount} onChange={(e) => { set('luggageCount')(e.target.value); }} dir="ltr" />
          </Field>
          <Field id="childSeats" label={t('childSeats')}>
            <Input id="childSeats" type="number" min={0} max={20} value={form.childSeats} onChange={(e) => { set('childSeats')(e.target.value); }} dir="ltr" />
          </Field>
          <Field id="budget" label={t('budget')} error={fe['budgetAmount']}>
            <Input id="budget" type="number" min={0} step="0.01" value={form.budget} onChange={(e) => { set('budget')(e.target.value); }} dir="ltr" />
          </Field>
          <div className="flex flex-col gap-2 md:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.wheelchair} onChange={(e) => { setForm((f) => ({ ...f, wheelchair: e.target.checked })); }} />
              {t('wheelchair')}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.femaleDriver} onChange={(e) => { setForm((f) => ({ ...f, femaleDriver: e.target.checked })); }} />
              {t('femaleDriver')}
            </label>
          </div>
          <Field id="instructions" label={t('instructions')} className="md:col-span-2">
            <Input id="instructions" value={form.instructions} onChange={(e) => { set('instructions')(e.target.value); }} />
          </Field>
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={busy || !form.vehicleCategoryId || !form.pickupCityId || !form.dropoffCityId}>
              {busy && <Loader2 className="animate-spin" />}
              {t('publishNow')}
            </Button>
            <Button type="button" variant="outline" disabled={busy || !form.vehicleCategoryId || !form.pickupCityId || !form.dropoffCityId} onClick={() => void submit(false)}>
              {t('saveDraft')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
