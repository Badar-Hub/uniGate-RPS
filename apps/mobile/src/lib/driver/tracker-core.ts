import type { ApiResult } from '@unigate/api-client';
import type { TrackingBatchResultDto, TrackingPingResultDto } from '@unigate/types';

/**
 * The location agent's pure core — the throttle, the offline queue and the batch flush of the
 * driver PWA's `lib/driver/tracker.ts`, with the GPS source and the storage injected so the
 * behaviour is unit-tested with fake timers. `src/lib/driver/tracker.ts` wires it to
 * expo-location (foreground watch or the background task) and AsyncStorage.
 *
 *  - one sample every PING_INTERVAL_MS at most (the API's ingest limit is per trip per minute;
 *    12/min in security.md T-30) → `POST /tracking/ping { tripId, latitude, longitude, accuracyM,
 *    speedKmh?, headingDeg?, recordedAt, source }` (validation `trackingPingBody`);
 *  - a sample the API could not be reached for (offline, 5xx, 429) is queued — up to QUEUE_MAX,
 *    oldest dropped — and persisted, then flushed in recorded order through
 *    `POST /tracking/ping/batch { points }` whose per-item results let one refused sample
 *    (stale, implausible) drop without blocking the rest;
 *  - a business refusal (`TRACKING_SESSION_NOT_ACTIVE`, `TRACKING_STALE_POINT`, 404 for a trip
 *    that is not the driver's) is never retried: it is counted and shown.
 */

export const PING_INTERVAL_MS = 5_000;
export const QUEUE_MAX = 200;
export const FLUSH_RETRY_MS = 15_000;

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

/** What a GPS fix looks like from expo-location (`LocationObject`) — speed in m/s, heading in degrees. */
export interface RawFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  /** Epoch milliseconds. */
  timestamp: number;
}

export interface TrackerCoreState {
  active: boolean;
  tripId: string | null;
  last: Sample | null;
  /** Samples the API accepted (single pings + batch acceptances) since the app started. */
  sent: number;
  queued: number;
  lastResult: TrackingPingResultDto | null;
  /** The last transport or API error code; cleared by the next accepted sample. */
  error: string | null;
  /** Samples the API refused on plausibility / business grounds (never retried). */
  rejected: number;
  lastRejection: string | null;
}

export interface TrackerCoreDeps {
  ping(sample: Sample): Promise<ApiResult<TrackingPingResultDto>>;
  pingBatch(points: Sample[]): Promise<ApiResult<TrackingBatchResultDto>>;
  loadQueue(): Promise<Sample[]>;
  saveQueue(queue: Sample[]): Promise<void>;
  now?: () => number;
}

type Listener = (s: TrackerCoreState) => void;

const INITIAL: TrackerCoreState = { active: false, tripId: null, last: null, sent: 0, queued: 0, lastResult: null, error: null, rejected: 0, lastRejection: null };

function round(n: number, dp: number): number {
  return Number(n.toFixed(dp));
}

/** A GPS fix → the ping body (`trackingPingBody`): 7 dp coordinates, integer metres / degrees, km/h to 1 dp. */
export function toSample(tripId: string, fix: RawFix): Sample {
  return {
    tripId,
    latitude: round(fix.latitude, 7),
    longitude: round(fix.longitude, 7),
    ...(fix.accuracy !== null && Number.isFinite(fix.accuracy) ? { accuracyM: Math.max(0, Math.round(fix.accuracy)) } : {}),
    ...(fix.heading !== null && Number.isFinite(fix.heading) && fix.heading >= 0 ? { headingDeg: Math.round(fix.heading) % 360 } : {}),
    ...(fix.speed !== null && Number.isFinite(fix.speed) && fix.speed >= 0 ? { speedKmh: round(fix.speed * 3.6, 1) } : {}),
    recordedAt: new Date(fix.timestamp).toISOString(),
    source: 'DRIVER_APP',
  };
}

/** Errors worth retrying: the API was unreachable, failed, or throttled — the sample itself may be fine. */
export function isTransient(error: { status: number }): boolean {
  return error.status === 0 || error.status >= 500 || error.status === 429;
}

export class TrackerCore {
  private state: TrackerCoreState = INITIAL;
  private listeners = new Set<Listener>();
  private queue: Sample[] = [];
  private lastSentAt = 0;
  private flushing = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private restored = false;

  constructor(private readonly deps: TrackerCoreDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => {
      this.listeners.delete(fn);
    };
  }

  get snapshot(): TrackerCoreState {
    return this.state;
  }

  private set(patch: Partial<TrackerCoreState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  /** Loads the persisted queue (samples from a previous run that never reached the API). */
  async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    try {
      const q = await this.deps.loadQueue();
      this.queue = q.slice(-QUEUE_MAX);
    } catch {
      this.queue = [];
    }
    this.set({ queued: this.queue.length });
  }

  start(tripId: string): void {
    if (this.state.active && this.state.tripId === tripId) return;
    this.lastSentAt = 0;
    this.set({ active: true, tripId, error: null, lastRejection: null });
    void this.flush();
  }

  /** Stops accepting fixes; queued samples are given one last flush (a closed session drops them per item). */
  stop(): void {
    if (this.flushTimer !== null) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.set({ active: false, tripId: null });
    if (this.queue.length) void this.flush();
  }

  /** A GPS fix from the watch or the background task. Throttled to one sample per interval. */
  async onFix(fix: RawFix): Promise<void> {
    const tripId = this.state.tripId;
    if (!this.state.active || !tripId) return;
    const now = this.now();
    if (now - this.lastSentAt < PING_INTERVAL_MS) return;
    this.lastSentAt = now;
    const sample = toSample(tripId, fix);
    this.set({ last: sample });
    await this.send(sample);
  }

  private async send(sample: Sample): Promise<void> {
    let res: ApiResult<TrackingPingResultDto>;
    try {
      res = await this.deps.ping(sample);
    } catch (e) {
      res = { ok: false, error: { status: 0, code: 'NETWORK', message: e instanceof Error ? e.message : 'failed' } };
    }
    if (res.ok) {
      this.set({ sent: this.state.sent + 1, lastResult: res.data, error: null });
      if (this.queue.length) void this.flush();
      return;
    }
    if (isTransient(res.error)) {
      await this.enqueue(sample);
      this.set({ error: res.error.code });
      this.scheduleFlush(res.error.status === 429 ? Math.max(FLUSH_RETRY_MS, (res.error.retryAfterSeconds ?? 0) * 1000) : FLUSH_RETRY_MS);
      return;
    }
    // A business refusal (no active session, implausible sample, not my trip): counted, never retried.
    this.set({ error: res.error.code, rejected: this.state.rejected + 1, lastRejection: res.error.code });
  }

  private async enqueue(sample: Sample): Promise<void> {
    this.queue.push(sample);
    if (this.queue.length > QUEUE_MAX) this.queue = this.queue.slice(-QUEUE_MAX);
    await this.persist();
  }

  private async persist(): Promise<void> {
    this.set({ queued: this.queue.length });
    try {
      await this.deps.saveQueue(this.queue);
    } catch {
      /* storage unavailable: the in-memory queue still flushes while the app lives */
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer !== null) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delayMs);
  }

  /** Flush queued samples in recorded order through the batch endpoint (per-item results). */
  async flush(): Promise<void> {
    if (this.flushing || !this.queue.length) return;
    this.flushing = true;
    try {
      const points = [...this.queue].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt)).slice(0, QUEUE_MAX);
      let res: ApiResult<TrackingBatchResultDto>;
      try {
        res = await this.deps.pingBatch(points);
      } catch (e) {
        res = { ok: false, error: { status: 0, code: 'NETWORK', message: e instanceof Error ? e.message : 'failed' } };
      }
      if (res.ok) {
        // Throttled items go back to the queue; every other refusal is final.
        const retry = new Set<number>();
        let rejected = 0;
        let lastRejection: string | null = null;
        for (const r of res.data.results) {
          // A refused item carries its code (the DTO's union); an accepted one never does.
          if (r.accepted || !('code' in r)) continue;
          if (r.code === 'RATE_LIMITED') retry.add(r.index);
          else {
            rejected++;
            lastRejection = r.code;
          }
        }
        const sentIds = new Set(points.filter((_, i) => !retry.has(i)));
        this.queue = this.queue.filter((s) => !sentIds.has(s));
        await this.persist();
        this.set({
          sent: this.state.sent + res.data.acceptedCount,
          rejected: this.state.rejected + rejected,
          ...(lastRejection ? { lastRejection } : {}),
          ...(rejected ? { error: lastRejection } : { error: null }),
        });
        if (this.queue.length && this.state.active) this.scheduleFlush(FLUSH_RETRY_MS);
        return;
      }
      if (isTransient(res.error)) {
        this.set({ error: res.error.code });
        if (this.state.active) this.scheduleFlush(FLUSH_RETRY_MS);
        return;
      }
      // The whole batch was refused on business grounds (e.g. the session ended): drop it rather than retry forever.
      this.queue = [];
      await this.persist();
      this.set({ error: res.error.code, rejected: this.state.rejected + points.length, lastRejection: res.error.code });
    } finally {
      this.flushing = false;
    }
  }
}
