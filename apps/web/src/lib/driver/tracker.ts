import type { TrackingBatchResultDto, TrackingPingResultDto } from '@unigate/types';
import { api } from '@/lib/api-client';

/**
 * The driver phone's location agent. Watches the device GPS while a trip is being tracked,
 * throttles samples to one every PING_INTERVAL_MS (well under the API's 30/min per trip), sends
 * each sample to POST /tracking/ping, and queues samples it could not deliver (offline, API down)
 * in localStorage so they are flushed in order through POST /tracking/ping/batch when the
 * connection returns. A screen wake lock keeps the page — and therefore the GPS watch — alive.
 *
 * Honest limits of a web agent: browsers stop GPS when the page is backgrounded or the screen
 * locks (iOS always; Android after a while). The wake lock mitigates it while the phone is on the
 * dashboard; true background tracking needs a native wrapper around the same API (see docs).
 */

export const PING_INTERVAL_MS = 5_000;
const QUEUE_KEY = 'ug.driver.pingQueue';
const QUEUE_MAX = 200;

export interface Sample {
  tripId: string;
  latitude: number;
  longitude: number;
  accuracyM?: number;
  headingDeg?: number;
  speedKmh?: number;
  recordedAt: string;
  source: 'DRIVER_APP';
}

export interface TrackerState {
  active: boolean;
  tripId: string | null;
  last: Sample | null;
  sent: number;
  queued: number;
  lastResult: TrackingPingResultDto | null;
  error: string | null;
  wakeLock: boolean;
  permission: 'unknown' | 'granted' | 'denied';
}

type Listener = (s: TrackerState) => void;

function readQueue(): Sample[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as Sample[]) : [];
  } catch {
    return [];
  }
}
function writeQueue(q: Sample[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-QUEUE_MAX)));
  } catch {
    /* storage unavailable: samples are best-effort */
  }
}

class Tracker {
  private state: TrackerState = { active: false, tripId: null, last: null, sent: 0, queued: readQueue().length, lastResult: null, error: null, wakeLock: false, permission: 'unknown' };
  private listeners = new Set<Listener>();
  private watchId: number | null = null;
  private lastSentAt = 0;
  private flushing = false;
  private wakeLockSentinel: { release(): Promise<void>; addEventListener(t: 'release', f: () => void): void } | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  private set(patch: Partial<TrackerState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }
  get snapshot(): TrackerState {
    return this.state;
  }

  async start(tripId: string): Promise<void> {
    if (this.state.active && this.state.tripId === tripId) return;
    this.stop();
    if (!('geolocation' in navigator)) {
      this.set({ error: 'GEOLOCATION_UNSUPPORTED' });
      return;
    }
    this.set({ active: true, tripId, error: null });
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        void this.onPosition(tripId, pos);
      },
      (err) => {
        this.set({ error: err.code === err.PERMISSION_DENIED ? 'PERMISSION_DENIED' : err.code === err.TIMEOUT ? 'TIMEOUT' : 'POSITION_UNAVAILABLE', permission: err.code === err.PERMISSION_DENIED ? 'denied' : this.state.permission });
      },
      { enableHighAccuracy: true, maximumAge: 2_000, timeout: 20_000 },
    );
    await this.acquireWakeLock();
    window.addEventListener('online', this.onOnline);
    document.addEventListener('visibilitychange', this.onVisibility);
    void this.flush();
  }

  stop(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    window.removeEventListener('online', this.onOnline);
    document.removeEventListener('visibilitychange', this.onVisibility);
    void this.wakeLockSentinel?.release();
    this.wakeLockSentinel = null;
    this.set({ active: false, tripId: null, wakeLock: false });
  }

  private onOnline = (): void => {
    void this.flush();
  };
  private onVisibility = (): void => {
    // The wake lock is released by the browser when the page is hidden; re-acquire on return.
    if (document.visibilityState === 'visible' && this.state.active) void this.acquireWakeLock();
  };

  private async acquireWakeLock(): Promise<void> {
    try {
      // Not every browser ships the Screen Wake Lock API; treat it as optional at runtime.
      const wakeLock = (navigator as { wakeLock?: unknown }).wakeLock as { request(type: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: 'release', f: () => void): void }> } | undefined;
      if (wakeLock === undefined) return;
      this.wakeLockSentinel = await wakeLock.request('screen');
      this.wakeLockSentinel.addEventListener('release', () => {
        this.set({ wakeLock: false });
      });
      this.set({ wakeLock: true });
    } catch {
      this.set({ wakeLock: false });
    }
  }

  private async onPosition(tripId: string, pos: GeolocationPosition): Promise<void> {
    this.set({ permission: 'granted' });
    const now = Date.now();
    if (now - this.lastSentAt < PING_INTERVAL_MS) return;
    this.lastSentAt = now;
    const c = pos.coords;
    const sample: Sample = {
      tripId,
      latitude: Number(c.latitude.toFixed(7)),
      longitude: Number(c.longitude.toFixed(7)),
      ...(Number.isFinite(c.accuracy) ? { accuracyM: Math.round(c.accuracy) } : {}),
      ...(c.heading !== null && !Number.isNaN(c.heading) ? { headingDeg: Math.round(c.heading) } : {}),
      ...(c.speed !== null && !Number.isNaN(c.speed) ? { speedKmh: Number((c.speed * 3.6).toFixed(1)) } : {}),
      recordedAt: new Date(pos.timestamp).toISOString(),
      source: 'DRIVER_APP',
    };
    this.set({ last: sample });
    await this.send(sample);
  }

  private async send(sample: Sample): Promise<void> {
    if (!navigator.onLine) {
      this.enqueue(sample);
      return;
    }
    const res = await api<TrackingPingResultDto>('/tracking/ping', { method: 'POST', body: sample });
    if (res.ok) {
      this.set({ sent: this.state.sent + 1, lastResult: res.data, error: null });
      if (this.state.queued) void this.flush();
      return;
    }
    // A business refusal (no active session, stale) is not retried; a transport failure is queued.
    if (res.error.status >= 500 || res.error.status === 0) this.enqueue(sample);
    else this.set({ error: res.error.code });
  }

  private enqueue(sample: Sample): void {
    const q = readQueue();
    q.push(sample);
    writeQueue(q);
    this.set({ queued: Math.min(q.length, QUEUE_MAX) });
  }

  /** Flush queued samples in recorded order through the batch endpoint (per-item results). */
  async flush(): Promise<void> {
    if (this.flushing || !navigator.onLine) return;
    const q = readQueue();
    if (!q.length) return;
    this.flushing = true;
    try {
      const points = q.slice(0, QUEUE_MAX);
      const res = await api<TrackingBatchResultDto>('/tracking/ping/batch', { method: 'POST', body: { points } });
      if (res.ok) {
        writeQueue(q.slice(points.length));
        this.set({ queued: Math.max(0, q.length - points.length), sent: this.state.sent + res.data.acceptedCount });
      } else if (res.error.status < 500) {
        // The whole batch was refused on business grounds (e.g. session ended): drop it rather than retry forever.
        writeQueue([]);
        this.set({ queued: 0, error: res.error.code });
      }
    } finally {
      this.flushing = false;
    }
  }
}

let instance: Tracker | null = null;
export function tracker(): Tracker {
  instance ??= new Tracker();
  return instance;
}
