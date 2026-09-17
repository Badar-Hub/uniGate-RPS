import { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { idempotencyKey } from '@unigate/api-client';
import type { BidDto } from '@unigate/types';
import { BidFormFields } from '@/components/bid-form';
import { Button, ErrorBanner, FormScreen, Muted, QueryState, Title } from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, apiErrorOf } from '@/lib/api';
import { buildBidBody, EMPTY_BID_FORM, KNOWN_BID_FIELDS, validateBidForm, type BidFormState } from '@/lib/bid-body';
import { keys, useInvalidate, useOpportunity } from '@/lib/queries';

/**
 * Place a bid on an opportunity (`POST /bids` ⧗, api.md §8.13) — the body is built exactly like
 * the web's `bid-form.tsx` (base amount, extras, notes) plus the optional driver, duration and
 * validity the schema accepts. The API answers with the computed VAT and total, shown on the
 * bid screen it navigates to.
 */
export default function NewBidScreen() {
  const { opportunityId } = useLocalSearchParams<{ opportunityId: string }>();
  const oid = typeof opportunityId === 'string' ? opportunityId : '';
  const { t, errorMessage } = useI18n();
  const router = useRouter();
  const invalidate = useInvalidate();
  const q = useOpportunity(oid);
  const action = useAction(KNOWN_BID_FIELDS);
  const [form, setForm] = useState<BidFormState>(EMPTY_BID_FORM);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  const o = q.data;
  const vehicles = (o?.eligibleVehicles ?? []).map((v) => ({
    value: v.id,
    label: v.plateNumberEn,
    hint: [v.categoryCode, v.passengerCapacity ? t('requests.form.seats', { count: v.passengerCapacity }) : null, v.payloadCapacityKg ? t('requests.form.payload', { kg: v.payloadCapacityKg }) : null].filter(Boolean).join(' · '),
  }));
  // One eligible vehicle: preselected, as the web's <select> does, until the owner picks another.
  const onlyVehicleId = o?.eligibleVehicles.length === 1 ? (o.eligibleVehicles[0]?.id ?? '') : '';
  const effective: BidFormState = form.vehicleId || !onlyVehicleId ? form : { ...form, vehicleId: onlyVehicleId };

  const fields: Record<string, string | undefined> = { ...action.fields };
  for (const [k, v] of Object.entries(clientErrors)) fields[k] = t(v);

  const submit = async () => {
    if (!o) return;
    const errors = validateBidForm(effective, { deadline: o.request.biddingClosesAt });
    setClientErrors(errors);
    action.clear();
    if (Object.keys(errors).length) return;
    const body = buildBidBody(o.request.id, effective);
    const bid = await action.run(() => api<BidDto>('/bids', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey() } }));
    if (!bid) return;
    await invalidate(keys.bids, keys.opportunities, keys.opportunity(oid));
    router.replace({ pathname: '/bids/[id]', params: { id: bid.id, created: '1' } });
  };

  return (
    <FormScreen>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {o ? (
          <View>
            <Title ltr>{t('bidForm.title', { number: o.request.requestNumber })}</Title>
            <Muted>{t('bidForm.description')}</Muted>
            <View className="mt-4">
              <ErrorBanner message={action.banner} />
              {!o.request.biddingOpen ? <ErrorBanner message={t('errors.TRIP_REQUEST_BIDDING_WINDOW_CLOSED')} /> : null}
            </View>
            <BidFormFields form={effective} onChange={setForm} vehicles={vehicles} fields={fields} deadline={o.request.biddingClosesAt} />
            <View className="mt-4">
              <Button title={t('bidForm.submit')} loading={action.busy} disabled={!o.request.biddingOpen} onPress={() => void submit()} />
            </View>
          </View>
        ) : null}
      </QueryState>
    </FormScreen>
  );
}
