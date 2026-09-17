import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import type { TrackingPositionDto } from '@unigate/types';
import { Card, Row, usePalette } from '@/components/ui';
import { config } from '@/config';
import { useI18n } from '@/i18n';
import { formatDateTime } from '@/lib/format';

export interface LatLng {
  latitude: number;
  longitude: number;
}

interface Props {
  position: TrackingPositionDto | null;
  pickup: LatLng & { addressLine: string };
  destination: LatLng & { addressLine: string };
  trail: LatLng[];
  etaLabel: string | null;
}

/**
 * The trip map: vehicle marker, pickup / drop-off pins and the polyline of recent positions.
 * Apple Maps on iOS needs nothing; Google Maps on Android needs `EXPO_PUBLIC_MAPS_ANDROID_KEY`
 * (app.config.ts). Without it — and inside Expo Go on Android, which has no key of ours — the
 * map cannot draw tiles, so the coordinates card below stands in and the flow stays testable.
 */
export function TripMap(props: Props) {
  const mapCapable = Platform.OS === 'ios' || config.mapsAndroidKeyConfigured;
  return (
    <View>
      {mapCapable ? (
        <MapBoundary fallback={<PositionCard {...props} reason="unavailable" />}>
          <LiveMap {...props} />
        </MapBoundary>
      ) : (
        <PositionCard {...props} reason="no-key" />
      )}
      {mapCapable ? <PositionCard {...props} reason={null} /> : null}
    </View>
  );
}

function LiveMap({ position, pickup, destination, trail }: Props) {
  const ref = useRef<MapView>(null);
  const followed = useRef(false);
  const colors = usePalette();
  const initial: Region = regionFor([pickup, destination]);

  useEffect(() => {
    if (!position || !ref.current) return;
    if (!followed.current) {
      ref.current.animateToRegion({ latitude: position.latitude, longitude: position.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 600);
      followed.current = true;
    } else {
      ref.current.animateCamera({ center: { latitude: position.latitude, longitude: position.longitude } }, { duration: 600 });
    }
  }, [position]);

  return (
    <MapView
      ref={ref}
      style={{ height: 300, borderRadius: 8 }}
      initialRegion={initial}
      {...(Platform.OS === 'android' ? { provider: PROVIDER_GOOGLE } : {})}
      showsCompass={false}
      toolbarEnabled={false}
    >
      <Marker coordinate={pickup} pinColor="#2563eb" title={pickup.addressLine} />
      <Marker coordinate={destination} pinColor="#dc2626" title={destination.addressLine} />
      {trail.length > 1 ? <Polyline coordinates={trail} strokeColor={colors.primary} strokeWidth={3} /> : null}
      {position ? (
        <Marker coordinate={position} anchor={{ x: 0.5, y: 0.5 }} flat rotation={position.headingDeg ?? 0}>
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.primary, borderWidth: 3, borderColor: '#fff' }} />
        </Marker>
      ) : null}
    </MapView>
  );
}

function PositionCard({ position, pickup, destination, etaLabel, reason }: Props & { reason: 'no-key' | 'unavailable' | null }) {
  const { t, locale } = useI18n();
  return (
    <View className="mt-3">
      {reason ? (
        <Text className="mb-2 text-xs text-muted-foreground text-start">
          {reason === 'no-key' ? t('tracking.noMapKey') : t('tracking.mapUnavailable')}
        </Text>
      ) : null}
      <Card>
        <Row label={t('tracking.vehiclePosition')} value={position ? `${position.latitude.toFixed(5)}, ${position.longitude.toFixed(5)}` : t('tracking.noPosition')} ltr />
        {position ? <Row label={t('tracking.recordedAt')} value={formatDateTime(position.recordedAt, locale)} ltr /> : null}
        {position?.speedKmh !== null && position?.speedKmh !== undefined ? <Row label={t('tracking.speed')} value={`${position.speedKmh} km/h`} ltr /> : null}
        <Row label={t('requests.pickup')} value={`${pickup.addressLine} (${pickup.latitude.toFixed(4)}, ${pickup.longitude.toFixed(4)})`} />
        <Row label={t('requests.dropoff')} value={`${destination.addressLine} (${destination.latitude.toFixed(4)}, ${destination.longitude.toFixed(4)})`} />
        {etaLabel ? <Row label={t('tracking.eta')} value={etaLabel} ltr /> : null}
      </Card>
    </View>
  );
}

function regionFor(points: LatLng[]): Region {
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.05, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(0.05, (maxLng - minLng) * 1.4),
  };
}

/** A render error inside the native map (missing module in a custom client, provider failure) must not take the screen down. */
class MapBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    console.warn(`[map] falling back to the coordinates card: ${error instanceof Error ? error.message : String(error)}`);
  }
  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Ticking "last seen N s ago" — kept here so the track screen stays declarative. */
export function useAgeSeconds(recordedAt: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(id);
    };
  }, []);
  if (!recordedAt) return null;
  return Math.max(0, Math.round((now - new Date(recordedAt).getTime()) / 1000));
}
