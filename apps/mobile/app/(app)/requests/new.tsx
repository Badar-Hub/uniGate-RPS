import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import { CARGO_TYPE, LOADING_RESPONSIBILITY, TRIP_PURPOSE, type TripRequestDto } from '@unigate/types';
import { DateTimeField } from '@/components/date-time-field';
import { SelectField } from '@/components/select-field';
import {
  Button,
  CheckRow,
  ErrorBanner,
  Field,
  FormScreen,
  Label,
  SectionTitle,
  Segmented,
  TextArea,
} from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api } from '@/lib/api';
import { keys, settingValue, stringList, useCities, useInvalidate, usePublicSettings, useSavedLocations, useVehicleCategories } from '@/lib/queries';
import { enumLabel } from '@/lib/status';
import {
  buildTripRequestBody,
  DEFAULT_FORM,
  DEFAULT_GOODS,
  DEFAULT_PASSENGER,
  KNOWN_REQUEST_FIELDS,
  validateRequestForm,
  type GoodsFormState,
  type PassengerFormState,
  type RequestFormState,
  type TransportType,
} from '@/lib/trip-request-body';

/**
 * New trip request (api.md §8.11 `POST /trip-requests`, ⧗ Idempotency-Key). Mirrors the web
 * form: the vertical toggle follows `platform.verticals_enabled`, categories follow the vertical,
 * saved locations fill the address + city (and supply the coordinates), otherwise the city
 * centre is sent. Field errors from a 422 land on the matching inputs; the rest go in the banner.
 */
export default function NewRequestScreen() {
  const { t, has, locale } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const action = useAction(KNOWN_REQUEST_FIELDS);

  const [form, setForm] = useState<RequestFormState>(DEFAULT_FORM);
  const [passenger, setPassenger] = useState<PassengerFormState>(DEFAULT_PASSENGER);
  const [goods, setGoods] = useState<GoodsFormState>(DEFAULT_GOODS);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const settings = usePublicSettings();
  const verticals = useMemo(() => {
    const v = stringList(settingValue(settings.data, 'platform.verticals_enabled'));
    return v.length ? v : ['PASSENGER'];
  }, [settings.data]);
  const categories = useVehicleCategories(form.transportType);
  const cities = useCities();
  const saved = useSavedLocations();

  const set = <K extends keyof RequestFormState>(k: K, v: RequestFormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const setP = <K extends keyof PassengerFormState>(k: K, v: PassengerFormState[K]) => {
    setPassenger((p) => ({ ...p, [k]: v }));
  };
  const setG = <K extends keyof GoodsFormState>(k: K, v: GoodsFormState[K]) => {
    setGoods((g) => ({ ...g, [k]: v }));
  };
  const fe = (key: string): string | undefined => {
    const c = clientErrors[key];
    if (c) return t(c);
    return action.fields[key];
  };

  const label = (x: { nameEn: string; nameAr: string }) => (locale === 'ar' ? x.nameAr : x.nameEn);
  const cityOptions = (cities.data ?? []).map((c) => ({ value: c.id, label: label(c) }));
  const categoryOptions = (categories.data ?? []).map((c) => ({
    value: c.id,
    label: label(c),
    hint: c.maxPassengerCapacity ? t('requests.form.seats', { count: c.maxPassengerCapacity }) : c.maxPayloadKg ? t('requests.form.payload', { kg: c.maxPayloadKg }) : undefined,
  }));
  const savedOptions = (saved.data ?? []).map((s) => ({ value: s.id, label: s.label, hint: s.addressLine }));

  const applySaved = (which: 'pickup' | 'dropoff', id: string) => {
    const s = saved.data?.find((x) => x.id === id);
    if (!s) return;
    setForm((f) =>
      which === 'pickup'
        ? { ...f, pickupAddress: s.addressLine, pickupCityId: s.cityId, pickupSavedId: s.id }
        : { ...f, dropoffAddress: s.addressLine, dropoffCityId: s.cityId, dropoffSavedId: s.id },
    );
  };

  const submit = async (publish: boolean) => {
    const errors = validateRequestForm(form, goods);
    setClientErrors(errors);
    action.clear();
    if (Object.keys(errors).length) return;
    const body = buildTripRequestBody(form, passenger, goods, { cities: cities.data ?? [], saved: saved.data ?? [] }, publish);
    const created = await action.run(() =>
      api<TripRequestDto>('/trip-requests', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } }),
    );
    if (!created) return;
    await invalidate(keys.requests);
    router.replace({ pathname: '/requests/[id]', params: { id: created.id, created: publish ? 'published' : 'draft' } });
  };

  const multi = Number(form.vehiclesRequired) > 1;
  const referenceError = categories.isError || cities.isError;

  return (
    <FormScreen>
      <ErrorBanner message={action.banner} />
      {referenceError ? <ErrorBanner message={t('requests.form.referenceFailed')} /> : null}

      {verticals.includes('GOODS') ? (
        <>
          <Label>{t('requests.form.transportType')}</Label>
          <Segmented<TransportType>
            options={[
              { value: 'PASSENGER', label: t('requests.form.vertical.PASSENGER') },
              { value: 'GOODS', label: t('requests.form.vertical.GOODS') },
            ]}
            value={form.transportType}
            onChange={(v) => {
              // The category lists differ per vertical: a change clears the chosen category.
              setForm((f) => ({ ...f, transportType: v, vehicleCategoryId: '' }));
            }}
          />
        </>
      ) : null}

      <SelectField
        label={t('requests.form.category')}
        value={form.vehicleCategoryId}
        options={categoryOptions}
        onChange={(v) => {
          set('vehicleCategoryId', v);
        }}
        placeholder={categories.isPending ? t('common.loading') : t('common.choose')}
        error={fe('vehicleCategoryId')}
      />

      <Label>{t('requests.form.vehiclesRequired')}</Label>
      <Field
        value={form.vehiclesRequired}
        onChangeText={(v) => {
          set('vehiclesRequired', v.replace(/[^0-9]/g, ''));
        }}
        keyboardType="number-pad"
        error={fe('vehiclesRequired')}
      />
      {multi ? (
        <>
          <Label>{t('requests.form.partial')}</Label>
          <Segmented
            options={[
              { value: 'no', label: t('requests.form.partialNo') },
              { value: 'yes', label: t('requests.form.partialYes') },
            ]}
            value={form.allowPartialFulfilment ? 'yes' : 'no'}
            onChange={(v) => {
              set('allowPartialFulfilment', v === 'yes');
            }}
          />
        </>
      ) : null}

      <Label>{t('requests.form.direction')}</Label>
      <Segmented
        options={[
          { value: 'ONE_WAY', label: t('requests.form.oneWay') },
          { value: 'ROUND_TRIP', label: t('requests.form.roundTrip') },
        ]}
        value={form.tripDirection}
        onChange={(v) => {
          set('tripDirection', v);
        }}
      />

      <SectionTitle>{t('requests.form.pickupSection')}</SectionTitle>
      {savedOptions.length ? (
        <SelectField
          label={t('requests.form.savedLocation')}
          value={form.pickupSavedId ?? ''}
          options={savedOptions}
          onChange={(v) => {
            applySaved('pickup', v);
          }}
          placeholder={t('common.choose')}
        />
      ) : null}
      <Label>{t('requests.form.pickupAddress')}</Label>
      <Field
        value={form.pickupAddress}
        onChangeText={(v) => {
          setForm((f) => ({ ...f, pickupAddress: v, pickupSavedId: null }));
        }}
        error={fe('pickup.addressLine')}
      />
      <SelectField
        label={t('requests.form.pickupCity')}
        value={form.pickupCityId}
        options={cityOptions}
        onChange={(v) => {
          setForm((f) => ({ ...f, pickupCityId: v, pickupSavedId: null }));
        }}
        placeholder={cities.isPending ? t('common.loading') : t('common.choose')}
        error={fe('pickup.cityId')}
      />
      <DateTimeField
        label={t('requests.form.pickupAt')}
        value={form.pickupAt}
        onChange={(d) => {
          set('pickupAt', d);
        }}
        minimumDate={new Date()}
        error={fe('pickupAt')}
        doneLabel={t('common.done')}
      />

      <SectionTitle>{t('requests.form.dropoffSection')}</SectionTitle>
      {savedOptions.length ? (
        <SelectField
          label={t('requests.form.savedLocation')}
          value={form.dropoffSavedId ?? ''}
          options={savedOptions}
          onChange={(v) => {
            applySaved('dropoff', v);
          }}
          placeholder={t('common.choose')}
        />
      ) : null}
      <Label>{t('requests.form.dropoffAddress')}</Label>
      <Field
        value={form.dropoffAddress}
        onChangeText={(v) => {
          setForm((f) => ({ ...f, dropoffAddress: v, dropoffSavedId: null }));
        }}
        error={fe('dropoff.addressLine')}
      />
      <SelectField
        label={t('requests.form.dropoffCity')}
        value={form.dropoffCityId}
        options={cityOptions}
        onChange={(v) => {
          setForm((f) => ({ ...f, dropoffCityId: v, dropoffSavedId: null }));
        }}
        placeholder={cities.isPending ? t('common.loading') : t('common.choose')}
        error={fe('dropoff.cityId')}
      />
      {form.tripDirection === 'ROUND_TRIP' ? (
        <DateTimeField
          label={t('requests.form.returnAt')}
          value={form.returnAt}
          onChange={(d) => {
            set('returnAt', d);
          }}
          minimumDate={form.pickupAt ?? new Date()}
          error={fe('returnAt')}
          doneLabel={t('common.done')}
        />
      ) : null}

      {form.transportType === 'PASSENGER' ? (
        <>
          <SectionTitle>{t('requests.form.passengers')}</SectionTitle>
          <Label>{t('requests.form.passengers')}</Label>
          <Field
            value={passenger.passengerCount}
            onChangeText={(v) => {
              setP('passengerCount', v.replace(/[^0-9]/g, ''));
            }}
            keyboardType="number-pad"
            error={fe('passengerDetails') ?? fe('passengerDetails.passengerCount')}
          />
          <Label>{t('requests.form.luggage')}</Label>
          <Field
            value={passenger.luggageCount}
            onChangeText={(v) => {
              setP('luggageCount', v.replace(/[^0-9]/g, ''));
            }}
            keyboardType="number-pad"
            error={fe('passengerDetails.luggageCount')}
          />
          <SelectField
            label={t('requests.form.purpose')}
            value={passenger.tripPurpose}
            options={TRIP_PURPOSE.map((p) => ({ value: p, label: enumLabel({ t, has }, 'tripPurpose', p) }))}
            onChange={(v) => {
              setP('tripPurpose', v);
            }}
          />
          <Label>{t('requests.form.childSeats')}</Label>
          <Field
            value={passenger.childSeats}
            onChangeText={(v) => {
              setP('childSeats', v.replace(/[^0-9]/g, ''));
            }}
            keyboardType="number-pad"
            error={fe('passengerDetails.childSeatsRequired')}
          />
          <CheckRow label={t('requests.form.wheelchair')} value={passenger.wheelchair} onChange={(v) => { setP('wheelchair', v); }} />
          <CheckRow label={t('requests.form.femaleDriver')} value={passenger.femaleDriver} onChange={(v) => { setP('femaleDriver', v); }} />
        </>
      ) : (
        <>
          <SectionTitle>{t('requests.form.goods.title')}</SectionTitle>
          <SelectField
            label={t('requests.form.goods.cargoType')}
            value={goods.cargoType}
            options={CARGO_TYPE.map((c) => ({ value: c, label: enumLabel({ t, has }, 'cargoType', c) }))}
            onChange={(v) => {
              setG('cargoType', v);
            }}
            error={fe('goodsDetails') ?? fe('goodsDetails.cargoType')}
          />
          <Label>{t('requests.form.goods.description')}</Label>
          <Field value={goods.cargoDescription} onChangeText={(v) => { setG('cargoDescription', v); }} error={fe('goodsDetails.cargoDescription')} />
          <Label>{t('requests.form.goods.weight')}</Label>
          <Field value={goods.cargoWeightKg} onChangeText={(v) => { setG('cargoWeightKg', v); }} keyboardType="decimal-pad" error={fe('goodsDetails.cargoWeightKg')} />
          <Label>{t('requests.form.goods.volume')}</Label>
          <Field value={goods.cargoVolumeM3} onChangeText={(v) => { setG('cargoVolumeM3', v); }} keyboardType="decimal-pad" error={fe('goodsDetails.cargoVolumeM3')} />
          <Label>{t('requests.form.goods.packages')}</Label>
          <Field value={goods.packageCount} onChangeText={(v) => { setG('packageCount', v.replace(/[^0-9]/g, '')); }} keyboardType="number-pad" error={fe('goodsDetails.packageCount')} />
          <SelectField
            label={t('requests.form.goods.loading')}
            value={goods.loadingResponsibility}
            options={LOADING_RESPONSIBILITY.map((r) => ({ value: r, label: enumLabel({ t, has }, 'responsibility', r) }))}
            onChange={(v) => { setG('loadingResponsibility', v); }}
          />
          <SelectField
            label={t('requests.form.goods.unloading')}
            value={goods.unloadingResponsibility}
            options={LOADING_RESPONSIBILITY.map((r) => ({ value: r, label: enumLabel({ t, has }, 'responsibility', r) }))}
            onChange={(v) => { setG('unloadingResponsibility', v); }}
          />
          <CheckRow label={t('requests.form.goods.refrigeration')} value={goods.requiresRefrigeration} onChange={(v) => { setG('requiresRefrigeration', v); }} />
          {goods.requiresRefrigeration ? (
            <View className="mb-2 flex-row items-center gap-2">
              <View className="flex-1">
                <Label>{t('requests.form.goods.tempMin')}</Label>
                <Field value={goods.tempMin} onChangeText={(v) => { setG('tempMin', v); }} keyboardType="numbers-and-punctuation" />
              </View>
              <View className="flex-1">
                <Label>{t('requests.form.goods.tempMax')}</Label>
                <Field value={goods.tempMax} onChangeText={(v) => { setG('tempMax', v); }} keyboardType="numbers-and-punctuation" />
              </View>
            </View>
          ) : null}
          <CheckRow label={t('requests.form.goods.tailLift')} value={goods.requiresTailLift} onChange={(v) => { setG('requiresTailLift', v); }} />
          <CheckRow label={t('requests.form.goods.crane')} value={goods.requiresCrane} onChange={(v) => { setG('requiresCrane', v); }} />
          <CheckRow label={t('requests.form.goods.insurance')} value={goods.requiresInsurance} onChange={(v) => { setG('requiresInsurance', v); }} />
          <Label>{t('requests.form.goods.declaredValue')}</Label>
          <Field value={goods.declaredValue} onChangeText={(v) => { setG('declaredValue', v); }} keyboardType="decimal-pad" error={fe('goodsDetails.declaredValueAmount')} />
          <Label>{t('requests.form.goods.loadingInstructions')}</Label>
          <Field value={goods.loadingInstructions} onChangeText={(v) => { setG('loadingInstructions', v); }} />
          <Label>{t('requests.form.goods.shipper')}</Label>
          <Field value={goods.shipperName} onChangeText={(v) => { setG('shipperName', v); }} />
          <Label>{t('requests.form.goods.shipperPhone')}</Label>
          <Field value={goods.shipperPhone} onChangeText={(v) => { setG('shipperPhone', v); }} keyboardType="phone-pad" placeholder="+9665XXXXXXXX" error={fe('goodsDetails.shipperContactPhone')} />
          <Label>{t('requests.form.goods.consignee')}</Label>
          <Field value={goods.consigneeName} onChangeText={(v) => { setG('consigneeName', v); }} />
          <Label>{t('requests.form.goods.consigneePhone')}</Label>
          <Field value={goods.consigneePhone} onChangeText={(v) => { setG('consigneePhone', v); }} keyboardType="phone-pad" placeholder="+9665XXXXXXXX" error={fe('goodsDetails.consigneeContactPhone')} />
        </>
      )}

      <SectionTitle>{t('requests.form.extras')}</SectionTitle>
      <Label>{t('requests.form.budget')}</Label>
      <Field value={form.budget} onChangeText={(v) => { set('budget', v); }} keyboardType="decimal-pad" error={fe('budgetAmount')} />
      <Label>{t('requests.form.instructions')}</Label>
      <TextArea value={form.instructions} onChangeText={(v) => { set('instructions', v); }} error={fe('specialInstructions')} />

      <Text className="mb-3 text-xs text-muted-foreground text-start">{t('requests.form.coordinatesHint')}</Text>
      <Button title={t('requests.form.publishNow')} loading={action.busy} onPress={() => void submit(true)} />
      <View className="mt-3">
        <Button title={t('requests.form.saveDraft')} variant="secondary" disabled={action.busy} onPress={() => void submit(false)} />
      </View>
    </FormScreen>
  );
}
