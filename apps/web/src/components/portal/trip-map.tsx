'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { TrackingPositionDto } from '@unigate/types';

/**
 * Leaflet map with OpenStreetMap tiles for development. Production maps need a licensed tile /
 * maps provider (the MapsProvider key, OQ pending) — the component takes a tile URL so that swap is
 * configuration, not code.
 */
const TILE_URL = process.env['NEXT_PUBLIC_MAP_TILE_URL'] ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '&copy; OpenStreetMap contributors';

const vehicleIcon = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#0f766e;border:3px solid #fff;box-shadow:0 0 0 2px #0f766e66"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
const pinIcon = (color: string) => L.divIcon({ className: '', html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] });

export function TripMap({ position, pickup, destination }: { position: TrackingPositionDto | null; pickup: { latitude: number; longitude: number }; destination: { latitude: number; longitude: number } }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const vehicle = useRef<L.Marker | null>(null);
  const trail = useRef<L.Polyline | null>(null);
  const followed = useRef(false);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true });
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(m);
    L.marker([pickup.latitude, pickup.longitude], { icon: pinIcon('#2563eb') }).addTo(m);
    L.marker([destination.latitude, destination.longitude], { icon: pinIcon('#dc2626') }).addTo(m);
    trail.current = L.polyline([], { color: '#0f766e', weight: 3, opacity: 0.7 }).addTo(m);
    m.fitBounds(L.latLngBounds([pickup.latitude, pickup.longitude], [destination.latitude, destination.longitude]), { padding: [30, 30] });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, [pickup.latitude, pickup.longitude, destination.latitude, destination.longitude]);

  useEffect(() => {
    const m = map.current;
    if (!m || !position) return;
    const at: L.LatLngExpression = [position.latitude, position.longitude];
    if (!vehicle.current) vehicle.current = L.marker(at, { icon: vehicleIcon, zIndexOffset: 1000 }).addTo(m);
    else vehicle.current.setLatLng(at);
    trail.current?.addLatLng(at);
    if (!followed.current) {
      m.setView(at, Math.max(m.getZoom(), 13));
      followed.current = true;
    } else if (!m.getBounds().contains(at)) {
      m.panTo(at);
    }
  }, [position]);

  return <div ref={el} className="h-72 w-full overflow-hidden rounded-md border md:h-96" />;
}
