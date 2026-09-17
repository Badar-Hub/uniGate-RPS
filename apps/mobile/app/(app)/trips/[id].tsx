import { useEffect, useState } from 'react';
import { Linking, Platform, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { LocationCard } from '@/components/driver/location-card';
import { TripActions } from '@/components/driver/trip-actions';
import { TripProofs } from '@/components/driver/trip-proofs';
import { Button, Card, ErrorBanner, Loading, Muted, QueryState, Row, Screen, SectionTitle, StatusBadge, Title, usePalette } from '@/components/ui';
import { useI18n } from '@/i18n';
import { apiErrorOf } from '@/lib/api';
import { tracker } from '@/lib/driver/tracker';
import { isTerminal, shouldTrack } from '@/lib/driver/transitions';
import { formatDateTime, formatMoney } from '@/lib/format';
import { keys, useInvalidate, useTrip, useTripHistory } from '@/lib/queries';
import { statusLabel, toneFor } from '@/lib/status';

function mapsUrl(lat: number, lng: number): string {
  return Platform.OS === 'ios' ? `http://maps.apple.com/?daddr=${lat},${lng}` : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
}

/**
 * The driver's trip screen (docs/mobile-app.md §15): `GET /trips/{id}` — booking summary
 * (pickup / drop-off with "open in maps", the scheduled window, vehicle, notes), the location
 * agent's card, the status buttons (`TripActions`), the proofs and the status history
 * (`GET /trips/{id}/status-history`). The agent starts by itself when the trip is in a tracked
 * state and stops when it ends; leaving the screen does not stop it (that is the point of the
 * background service) — a terminal status or sign-out does.
 */
export default function DriverTripScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tripId = typeof id === 'string' ? id : '';
  const { t, has, locale, errorMessage } = useI18n();
  const colors = usePalette();
  const invalidate = useInvalidate();
  const q = useTrip(tripId);
  const history = useTripHistory(tripId);
  const [manualOff, setManualOff] = useState(false);

  const trip = q.data;
  const tracked = Boolean(trip && shouldTrack(trip.status));

  useEffect(() => {
    if (!trip) return;
    if (tracked && !manualOff) {
      void tracker().start(trip.id, { notificationTitle: t('driver.location.serviceTitle'), notificationBody: t('driver.location.serviceBody', { trip: trip.tripNumber }) });
    } else if (tracker().snapshot.tripId === trip.id) {
      void tracker().stop();
    }
  }, [trip, tracked, manualOff, t]);

  const refresh = () => invalidate(keys.trip(tripId), keys.tripHistory(tripId), keys.trips, keys.activeTrips, keys.tripProofs(tripId));

  return (
    <Screen header>
      <QueryState pending={q.isPending} error={q.isError ? errorMessage(apiErrorOf(q.error)) : null} retryLabel={t('common.retry')} onRetry={() => void q.refetch()}>
        {trip ? (
          <ScrollView
            contentContainerClassName="py-4 pb-12"
            refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void refresh()} tintColor={colors.primary} />}
          >
            <View className="flex-row items-start justify-between gap-3">
              <View className="flex-1">
                <Title ltr>{trip.tripNumber}</Title>
                <Muted ltr>
                  {trip.bookingNumber} · {trip.vehicle.plateNumberEn}
                </Muted>
              </View>
              <StatusBadge label={statusLabel({ t, has }, 'trip', trip.status)} tone={toneFor('trip', trip.status)} />
            </View>

            <View className="mt-4">
              <Card>
                <Text className="text-xs text-muted-foreground text-start">{t('driver.trip.pickup')}</Text>
                <Text className="text-base text-card-foreground text-start">{trip.pickup.addressLine}</Text>
                <View className="mt-1 mb-3 flex-row">
                  <Button title={t('driver.trip.openMap')} variant="ghost" onPress={() => void Linking.openURL(mapsUrl(trip.pickup.latitude, trip.pickup.longitude))} />
                </View>
                <Text className="text-xs text-muted-foreground text-start">{t('driver.trip.dropoff')}</Text>
                <Text className="text-base text-card-foreground text-start">{trip.dropoff.addressLine}</Text>
                <View className="mt-1 mb-2 flex-row">
                  <Button title={t('driver.trip.openMap')} variant="ghost" onPress={() => void Linking.openURL(mapsUrl(trip.dropoff.latitude, trip.dropoff.longitude))} />
                </View>
                <Row label={t('driver.trip.scheduled')} value={`${formatDateTime(trip.scheduledStartAt, locale)} → ${formatDateTime(trip.scheduledEndAt, locale)}`} ltr />
                <Row label={t('driver.trip.vehicle')} value={`${trip.vehicle.plateNumberEn} · ${trip.vehicle.description}`} ltr />
                <Row label={t('driver.trip.vertical')} value={has(`requests.form.vertical.${trip.transportType}`) ? t(`requests.form.vertical.${trip.transportType}`) : trip.transportType} />
                {trip.regulatoryReference ? <Row label={t('driver.trip.bayanPrompt')} value={`${trip.regulatoryReference} (${trip.regulatoryReferenceType ?? '—'})`} ltr /> : null}
                {trip.customerNotes ? <Row label={t('driver.trip.customerNotes')} value={trip.customerNotes} /> : null}
                {trip.driverNotes ? <Row label={t('driver.trip.driverNotes')} value={trip.driverNotes} /> : null}
                {trip.actualStartAt ? <Row label={t('driver.trip.actualStart')} value={formatDateTime(trip.actualStartAt, locale)} ltr /> : null}
                {trip.actualEndAt ? <Row label={t('driver.trip.actualEnd')} value={formatDateTime(trip.actualEndAt, locale)} ltr /> : null}
                {trip.startOdometerKm !== null || trip.endOdometerKm !== null ? (
                  <Row label={t('driver.trip.odometer')} value={`${trip.startOdometerKm ?? '—'} → ${trip.endOdometerKm ?? '—'} km`} ltr />
                ) : null}
                {trip.actualDistanceKm ? <Row label={t('driver.trip.distance')} value={`${formatMoney(trip.actualDistanceKm)} km`} ltr /> : null}
              </Card>
            </View>

            {!isTerminal(trip.status) ? (
              <LocationCard
                tracked={tracked}
                manualOff={manualOff}
                onToggle={() => {
                  setManualOff((v) => !v);
                }}
              />
            ) : null}

            <SectionTitle>{t('driver.trip.actions')}</SectionTitle>
            <TripActions trip={trip} onUpdated={() => void refresh()} />

            <TripProofs trip={trip} />

            <SectionTitle>{t('driver.trip.history')}</SectionTitle>
            <Card>
              {history.isPending ? (
                <Loading />
              ) : history.isError ? (
                <ErrorBanner message={errorMessage(apiErrorOf(history.error))} />
              ) : history.data?.length ? (
                history.data.map((h, i) => (
                  <View key={h.id} className={`flex-row items-start gap-3 py-2 ${i > 0 ? 'border-t border-border' : ''}`}>
                    <View className="mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <View className="flex-1">
                      <View className="flex-row items-center justify-between gap-2">
                        <StatusBadge label={statusLabel({ t, has }, 'trip', h.toStatus)} tone={toneFor('trip', h.toStatus)} />
                        <Text className="text-xs text-muted-foreground" style={{ writingDirection: 'ltr' }}>
                          {formatDateTime(h.occurredAt, locale)}
                        </Text>
                      </View>
                      {h.note ? <Muted>{h.note}</Muted> : null}
                      {h.latitude !== null && h.longitude !== null ? (
                        <Muted ltr>
                          {h.latitude.toFixed(5)}, {h.longitude.toFixed(5)}
                          {h.accuracyM !== null ? ` · ±${h.accuracyM} m` : ''}
                        </Muted>
                      ) : null}
                    </View>
                  </View>
                ))
              ) : (
                <Muted>{t('common.empty')}</Muted>
              )}
            </Card>
          </ScrollView>
        ) : null}
      </QueryState>
    </Screen>
  );
}
