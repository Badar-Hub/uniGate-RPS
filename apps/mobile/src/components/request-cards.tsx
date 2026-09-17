import { View } from 'react-native';
import type { TripRequestDto } from '@unigate/types';
import { Badge, Card, Muted, Row, SectionTitle } from '@/components/ui';
import { useI18n } from '@/i18n';
import { formatDateTime, formatMoney } from '@/lib/format';
import { enumLabel } from '@/lib/status';

/**
 * The route / timing card and the passenger or goods detail card of a trip request, shared by
 * the customer's request screen and the owner's opportunity screen. The owner projection is
 * redacted by the API (contacts and instructions are null until an accepted bid), so the same
 * component renders both: absent fields are simply not shown.
 */
export function RequestRouteCard({ r }: { r: TripRequestDto }) {
  const { t, locale } = useI18n();
  return (
    <>
      <SectionTitle>{t('requests.route')}</SectionTitle>
      <Card>
        <Row label={t('requests.pickup')} value={r.pickup.addressLine} />
        <Row label={t('requests.dropoff')} value={r.dropoff.addressLine} />
        <Row label={t('requests.form.pickupAt')} value={formatDateTime(r.pickupAt, locale)} ltr />
        {r.returnAt ? <Row label={t('requests.form.returnAt')} value={formatDateTime(r.returnAt, locale)} ltr /> : null}
        <Row label={t('requests.form.direction')} value={r.tripDirection === 'ROUND_TRIP' ? t('requests.form.roundTrip') : t('requests.form.oneWay')} />
        <Row label={t('requests.detail.deadline')} value={formatDateTime(r.biddingClosesAt, locale)} ltr />
        {r.estimatedDistanceKm ? (
          <Row
            label={t('requests.detail.estimate')}
            value={`${t('requests.detail.distance', { km: r.estimatedDistanceKm })} · ${t('requests.detail.duration', { min: r.estimatedDurationMinutes ?? 0 })}`}
            ltr
          />
        ) : null}
        {r.budgetAmount ? <Row label={t('requests.form.budget')} value={formatMoney(r.budgetAmount, r.currency)} ltr /> : null}
        {r.specialInstructions ? <Row label={t('requests.detail.instructions')} value={r.specialInstructions} /> : null}
      </Card>
    </>
  );
}

export function RequestDetailCard({ r }: { r: TripRequestDto }) {
  const { t, has } = useI18n();
  if (r.passengerDetails) {
    const p = r.passengerDetails;
    return (
      <>
        <SectionTitle>{t('requests.form.passengers')}</SectionTitle>
        <Card>
          <Row label={t('requests.form.purpose')} value={enumLabel({ t, has }, 'tripPurpose', p.tripPurpose)} />
          <Row label={t('requests.form.passengers')} value={String(p.passengerCount)} ltr />
          <Row label={t('requests.form.luggage')} value={String(p.luggageCount)} ltr />
          {p.childSeatsRequired > 0 ? <Row label={t('requests.form.childSeats')} value={String(p.childSeatsRequired)} ltr /> : null}
          <View className="mt-2 flex-row flex-wrap gap-2">
            {p.requiresWheelchairAccess ? <Badge>{t('requests.form.wheelchair')}</Badge> : null}
            {p.requiresFemaleDriver ? <Badge>{t('requests.form.femaleDriver')}</Badge> : null}
          </View>
        </Card>
      </>
    );
  }
  if (r.goodsDetails) {
    const g = r.goodsDetails;
    return (
      <>
        <SectionTitle>{t('requests.form.goods.title')}</SectionTitle>
        <Card>
          <Row label={t('requests.form.goods.cargoType')} value={enumLabel({ t, has }, 'cargoType', g.cargoType)} />
          <Row label={t('requests.form.goods.description')} value={g.cargoDescription} />
          <Row label={t('requests.form.goods.weight')} value={`${g.cargoWeightKg} kg`} ltr />
          {g.cargoVolumeM3 ? <Row label={t('requests.form.goods.volume')} value={`${g.cargoVolumeM3} m³`} ltr /> : null}
          {g.packageCount !== null ? <Row label={t('requests.form.goods.packages')} value={String(g.packageCount)} ltr /> : null}
          {g.requiresRefrigeration ? (
            <Row label={t('requests.form.goods.refrigeration')} value={`${g.requiredTemperatureMinC ?? ''}–${g.requiredTemperatureMaxC ?? ''} °C`} ltr />
          ) : null}
          <Row label={t('requests.form.goods.loading')} value={enumLabel({ t, has }, 'responsibility', g.loadingResponsibility)} />
          <Row label={t('requests.form.goods.unloading')} value={enumLabel({ t, has }, 'responsibility', g.unloadingResponsibility)} />
          {g.declaredValueAmount ? <Row label={t('requests.form.goods.declaredValue')} value={formatMoney(g.declaredValueAmount, r.currency)} ltr /> : null}
          <View className="mt-2 flex-row flex-wrap gap-2">
            {g.requiresTailLift ? <Badge>{t('requests.form.goods.tailLift')}</Badge> : null}
            {g.requiresCrane ? <Badge>{t('requests.form.goods.crane')}</Badge> : null}
            {g.requiresInsurance ? <Badge>{t('requests.form.goods.insurance')}</Badge> : null}
          </View>
          {g.loadingInstructions ? <Muted>{g.loadingInstructions}</Muted> : null}
          {(g.shipperContactName ?? g.consigneeContactName) ? (
            <Muted ltr>
              {[g.shipperContactName, g.shipperContactPhone].filter(Boolean).join(' ')} →{' '}
              {[g.consigneeContactName, g.consigneeContactPhone].filter(Boolean).join(' ')}
            </Muted>
          ) : null}
        </Card>
      </>
    );
  }
  return null;
}
