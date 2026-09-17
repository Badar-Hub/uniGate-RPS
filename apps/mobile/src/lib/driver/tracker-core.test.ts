import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '@unigate/api-client';
import type { TrackingBatchResultDto, TrackingPingResultDto } from '@unigate/types';
import { FLUSH_RETRY_MS, PING_INTERVAL_MS, QUEUE_MAX, TrackerCore, isTransient, toSample, type RawFix, type Sample } from './tracker-core';

const ACCEPTED: TrackingPingResultDto = { accepted: true, persisted: true, sequence: 1, lowConfidence: false };
const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, data, meta: {} });
const fail = <T,>(status: number, code: string, extra: Record<string, unknown> = {}): ApiResult<T> => ({ ok: false, error: { status, code, message: code, ...extra } });

function fix(overrides: Partial<RawFix> = {}): RawFix {
  return { latitude: 24.71361234567, longitude: 46.67532109876, accuracy: 12.4, heading: 91.6, speed: 13.9, timestamp: Date.now(), ...overrides };
}

const offline = () => Promise.reject(new Error('offline'));
const acceptAll = (points: Sample[]) => Promise.resolve(ok<TrackingBatchResultDto>({ acceptedCount: points.length, results: points.map((_, index) => ({ index, ...ACCEPTED })) }));

function harness() {
  let stored: Sample[] = [];
  const ping = vi.fn<(s: Sample) => Promise<ApiResult<TrackingPingResultDto>>>(() => Promise.resolve(ok(ACCEPTED)));
  const pingBatch = vi.fn<(p: Sample[]) => Promise<ApiResult<TrackingBatchResultDto>>>(acceptAll);
  const saveQueue = vi.fn((q: Sample[]) => {
    stored = [...q];
    return Promise.resolve();
  });
  const loadQueue = vi.fn(() => Promise.resolve(stored));
  const core = new TrackerCore({ ping, pingBatch, saveQueue, loadQueue });
  return { core, ping, pingBatch, saveQueue, loadQueue, stored: () => stored };
}

// setImmediate stays real (see useFakeTimers below) so awaiting it settles the promise chains the timers started.
const flushPromises = () => new Promise<void>((r) => { setImmediate(r); });
async function advance(ms: number) {
  vi.advanceTimersByTime(ms);
  await flushPromises();
}

describe('toSample', () => {
  it('builds the trackingPingBody: 7 dp coordinates, integer accuracy / heading, km/h speed, ISO time, DRIVER_APP', () => {
    const s = toSample('trip-1', { latitude: 24.71361234567, longitude: 46.67532109876, accuracy: 12.4, heading: 91.6, speed: 13.9, timestamp: Date.UTC(2026, 8, 17, 10, 0, 0) });
    expect(s).toEqual({ tripId: 'trip-1', latitude: 24.7136123, longitude: 46.6753211, accuracyM: 12, headingDeg: 92, speedKmh: 50, recordedAt: '2026-09-17T10:00:00.000Z', source: 'DRIVER_APP' });
  });
  it('omits what the device does not know (Android reports -1 for an unknown heading / speed)', () => {
    const s = toSample('t', { latitude: 1, longitude: 2, accuracy: null, heading: -1, speed: -1, timestamp: 0 });
    expect(s).toEqual({ tripId: 't', latitude: 1, longitude: 2, recordedAt: '1970-01-01T00:00:00.000Z', source: 'DRIVER_APP' });
    expect(toSample('t', { latitude: 1, longitude: 2, accuracy: Number.NaN, heading: 360, speed: 0, timestamp: 0 })).toMatchObject({ headingDeg: 0, speedKmh: 0 });
  });
});

describe('isTransient', () => {
  it('retries only when the API was unreachable, failed or throttled', () => {
    expect(isTransient({ status: 0 })).toBe(true);
    expect(isTransient({ status: 503 })).toBe(true);
    expect(isTransient({ status: 429 })).toBe(true);
    expect(isTransient({ status: 422 })).toBe(false);
    expect(isTransient({ status: 404 })).toBe(false);
  });
});

describe('TrackerCore', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-09-17T10:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores fixes until started and throttles to one sample per PING_INTERVAL_MS', async () => {
    const h = harness();
    await h.core.onFix(fix());
    expect(h.ping).not.toHaveBeenCalled();

    h.core.start('trip-1');
    await h.core.onFix(fix());
    await h.core.onFix(fix({ latitude: 25 }));
    await advance(PING_INTERVAL_MS - 1);
    await h.core.onFix(fix({ latitude: 26 }));
    expect(h.ping).toHaveBeenCalledTimes(1);
    expect(h.core.snapshot.sent).toBe(1);
    expect(h.core.snapshot.last?.tripId).toBe('trip-1');

    await advance(1);
    await h.core.onFix(fix({ latitude: 26 }));
    expect(h.ping).toHaveBeenCalledTimes(2);
    expect(h.ping.mock.calls[1]?.[0]).toMatchObject({ latitude: 26, recordedAt: '2026-09-17T10:00:05.000Z' });
    expect(h.core.snapshot).toMatchObject({ sent: 2, queued: 0, error: null, lastResult: ACCEPTED });
  });

  it('queues a sample the API could not be reached for, persists the queue, and caps it at QUEUE_MAX (oldest dropped)', async () => {
    const h = harness();
    h.ping.mockImplementation(offline);
    h.pingBatch.mockImplementation(offline);
    h.core.start('trip-1');
    for (let i = 0; i < QUEUE_MAX + 5; i++) {
      await h.core.onFix(fix({ latitude: i }));
      await advance(PING_INTERVAL_MS);
    }
    expect(h.core.snapshot.queued).toBe(QUEUE_MAX);
    expect(h.core.snapshot.error).toBe('NETWORK');
    expect(h.stored()).toHaveLength(QUEUE_MAX);
    expect(h.stored()[0]?.latitude).toBe(5);
    expect(h.stored()[QUEUE_MAX - 1]?.latitude).toBe(QUEUE_MAX + 4);
    expect(h.core.snapshot.sent).toBe(0);
  });

  it('queues on a 5xx and a 429, but never on a business refusal — which is counted and shown', async () => {
    const h = harness();
    h.pingBatch.mockImplementation(offline);
    h.core.start('trip-1');
    h.ping.mockResolvedValueOnce(fail(503, 'INTERNAL_ERROR'));
    await h.core.onFix(fix());
    await advance(PING_INTERVAL_MS);
    h.ping.mockResolvedValueOnce(fail(429, 'RATE_LIMITED', { retryAfterSeconds: 20 }));
    await h.core.onFix(fix());
    await advance(PING_INTERVAL_MS);
    h.ping.mockResolvedValueOnce(fail(422, 'TRACKING_STALE_POINT'));
    await h.core.onFix(fix());
    expect(h.core.snapshot).toMatchObject({ queued: 2, rejected: 1, lastRejection: 'TRACKING_STALE_POINT', error: 'TRACKING_STALE_POINT' });
    await advance(PING_INTERVAL_MS);
    h.ping.mockResolvedValueOnce(fail(422, 'TRACKING_SESSION_NOT_ACTIVE'));
    await h.core.onFix(fix());
    expect(h.core.snapshot).toMatchObject({ queued: 2, rejected: 2, lastRejection: 'TRACKING_SESSION_NOT_ACTIVE' });
  });

  it('flushes the queue in recorded order through the batch endpoint after the next accepted ping', async () => {
    const h = harness();
    h.core.start('trip-1');
    h.ping.mockImplementation(offline);
    await h.core.onFix(fix({ latitude: 1 }));
    await advance(PING_INTERVAL_MS);
    await h.core.onFix(fix({ latitude: 2 }));
    await advance(PING_INTERVAL_MS);
    expect(h.core.snapshot.queued).toBe(2);

    h.ping.mockImplementation(() => Promise.resolve(ok(ACCEPTED)));
    await h.core.onFix(fix({ latitude: 3 }));
    await flushPromises();
    expect(h.pingBatch).toHaveBeenCalledTimes(1);
    const points = h.pingBatch.mock.calls[0]?.[0] ?? [];
    expect(points.map((p) => p.latitude)).toEqual([1, 2]);
    expect((points[0]?.recordedAt ?? '') < (points[1]?.recordedAt ?? '')).toBe(true);
    expect(h.core.snapshot).toMatchObject({ queued: 0, sent: 3, error: null });
    expect(h.stored()).toEqual([]);
  });

  it('applies per-item batch results: a refused sample is dropped and counted, a throttled one goes back in the queue', async () => {
    const h = harness();
    h.core.start('trip-1');
    h.ping.mockImplementation(offline);
    h.pingBatch.mockImplementation(offline);
    for (const lat of [1, 2, 3]) {
      await h.core.onFix(fix({ latitude: lat }));
      await advance(PING_INTERVAL_MS);
    }
    expect(h.core.snapshot.queued).toBe(3);

    h.pingBatch.mockImplementation(acceptAll);
    h.pingBatch.mockResolvedValueOnce(ok({ acceptedCount: 1, results: [{ index: 0, accepted: false, code: 'TRACKING_STALE_POINT' }, { index: 1, ...ACCEPTED }, { index: 2, accepted: false, code: 'RATE_LIMITED' }] }));
    const before = h.pingBatch.mock.calls.length;
    await h.core.flush();
    expect(h.core.snapshot).toMatchObject({ queued: 1, sent: 1, rejected: 1, lastRejection: 'TRACKING_STALE_POINT' });
    expect(h.stored().map((s) => s.latitude)).toEqual([3]);

    // The retry timer sends the throttled one again once the window passes.
    await advance(FLUSH_RETRY_MS);
    expect(h.pingBatch.mock.calls.length).toBeGreaterThan(before + 1);
    expect(h.pingBatch.mock.calls.at(-1)?.[0]?.map((p) => p.latitude)).toEqual([3]);
    expect(h.core.snapshot).toMatchObject({ queued: 0, sent: 2 });
  });

  it('keeps the queue when the batch call itself fails transiently and retries on the timer; drops it on a business refusal', async () => {
    const h = harness();
    h.core.start('trip-1');
    h.ping.mockImplementation(offline);
    await h.core.onFix(fix({ latitude: 1 }));
    await advance(PING_INTERVAL_MS);
    await h.core.onFix(fix({ latitude: 2 }));

    h.pingBatch.mockResolvedValueOnce(fail(0, 'NETWORK'));
    await h.core.flush();
    expect(h.core.snapshot).toMatchObject({ queued: 2, error: 'NETWORK' });

    h.pingBatch.mockResolvedValueOnce(fail(422, 'TRACKING_SESSION_NOT_ACTIVE'));
    await advance(FLUSH_RETRY_MS);
    expect(h.pingBatch).toHaveBeenCalledTimes(2);
    expect(h.core.snapshot).toMatchObject({ queued: 0, rejected: 2, error: 'TRACKING_SESSION_NOT_ACTIVE' });
    expect(h.stored()).toEqual([]);
  });

  it('restores the persisted queue from a previous run and flushes it when the trip starts', async () => {
    const h = harness();
    const old: Sample = { tripId: 'trip-1', latitude: 1, longitude: 2, recordedAt: '2026-09-17T09:59:00.000Z', source: 'DRIVER_APP' };
    h.loadQueue.mockResolvedValueOnce([old]);
    await h.core.restore();
    expect(h.core.snapshot.queued).toBe(1);
    h.core.start('trip-1');
    await flushPromises();
    expect(h.pingBatch).toHaveBeenCalledWith([old]);
    expect(h.core.snapshot).toMatchObject({ queued: 0, sent: 1 });
  });

  it('stop() stops accepting fixes and gives the queue one last flush without scheduling retries', async () => {
    const h = harness();
    h.core.start('trip-1');
    h.ping.mockImplementation(offline);
    await h.core.onFix(fix());
    expect(h.core.snapshot.queued).toBe(1);
    h.pingBatch.mockResolvedValueOnce(fail(0, 'NETWORK'));
    h.core.stop();
    await flushPromises();
    expect(h.core.snapshot).toMatchObject({ active: false, tripId: null, queued: 1 });
    await advance(PING_INTERVAL_MS);
    await h.core.onFix(fix());
    expect(h.ping).toHaveBeenCalledTimes(1);
    await advance(FLUSH_RETRY_MS * 2);
    expect(h.pingBatch).toHaveBeenCalledTimes(1);
  });
});
