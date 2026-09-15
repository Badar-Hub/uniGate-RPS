import { config } from '@/config/index.js';
import { logger } from '@/logging/logger.js';

/**
 * MapsProvider (architecture.md §8). Phase 6 needs one method — a route estimate snapshotted
 * onto the request (FR-DEMAND-08). `estimate` is real geometry (great-circle distance × a road
 * factor at a KSA intercity average speed), clearly named as an estimate, never a fake call to a
 * routing API. The Google/Mapbox adapter is added when UniGate supplies a server key
 * (MAPS_SERVER_KEY); until then the config does not let `google` be selected.
 */
export interface RouteEstimate {
  distanceKm: number;
  durationMinutes: number;
  /** Which provider produced it — stored alongside for auditability. */
  source: string;
}

export interface MapsProvider {
  readonly code: string;
  route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteEstimate | null>;
}

const EARTH_KM = 6371.0088;
/** Straight-line → road distance; typical for the KSA highway network. */
const ROAD_FACTOR = 1.3;
const AVG_SPEED_KMH = 70;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

export class EstimateMapsProvider implements MapsProvider {
  readonly code = 'estimate';
  async route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteEstimate> {
    const km = haversineKm(from, to) * ROAD_FACTOR;
    return Promise.resolve({ distanceKm: Math.round(km * 100) / 100, durationMinutes: Math.max(5, Math.round((km / AVG_SPEED_KMH) * 60)), source: 'estimate' });
  }
}

let instance: MapsProvider | null = null;

export function mapsProvider(): MapsProvider {
  if (!instance) {
    instance = new EstimateMapsProvider();
    logger().info({ provider: instance.code, hasServerKey: Boolean(config().providers.mapsServerKey) }, 'maps provider ready');
  }
  return instance;
}

export function setMapsProviderForTests(p: MapsProvider | null): void {
  instance = p;
}
