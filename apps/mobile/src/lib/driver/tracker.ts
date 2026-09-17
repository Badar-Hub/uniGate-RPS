import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import type { TrackingBatchResultDto, TrackingPingResultDto } from '@unigate/types';
import { api } from '@/lib/api';
import { isExpoGo } from '@/lib/push';
import { PING_INTERVAL_MS, TrackerCore, type RawFix, type Sample, type TrackerCoreState } from './tracker-core';

/**
 * The driver phone's location agent — the native port of the PWA's `lib/driver/tracker.ts`
 * (docs/mobile-app.md §15). The throttle / queue / flush live in `TrackerCore`; this module owns
 * the device side:
 *
 *  - **Background** (development / store builds): `expo-location`'s
 *    `startLocationUpdatesAsync` with the `LOCATION_TASK` TaskManager task, high accuracy,
 *    updates deferred to the 5 s cadence, an Android foreground-service notification so the OS
 *    keeps the process alive, and `UIBackgroundModes: location` on iOS (app.config.ts). The task
 *    is defined at module scope — this file is imported from the root layout — so a headless
 *    relaunch of the JS can still deliver samples: the active trip id is persisted and the API
 *    client refreshes its access token from SecureStore.
 *  - **Foreground only** when background permission is refused (stated in the UI) and always in
 *    Expo Go, whose runtime cannot register background tasks: `watchPositionAsync` streams while
 *    the app is open.
 *
 * Permissions are asked in order — foreground ("while using"), then background ("all the
 * time"); a refusal degrades rather than blocks. Nothing here decides *whether* to track: the
 * trip screen starts the agent when the trip enters a tracked state and stops it when it ends.
 */

export const LOCATION_TASK = 'unigate-driver-location';
const QUEUE_KEY = 'ug.driver.pingQueue';
const ACTIVE_KEY = 'ug.driver.activeTrip';
/** A fix this recent is reused for a status transition instead of asking the GPS again. */
const FRESH_FIX_MS = 30_000;
const ONE_SHOT_TIMEOUT_MS = 8_000;

export type TrackerMode = 'off' | 'background' | 'foreground' | 'expo-go';
export type LocationPermission = 'unknown' | 'foreground' | 'background' | 'denied';

export interface TrackerState extends TrackerCoreState {
  mode: TrackerMode;
  permission: LocationPermission;
  /** Device-side failure (permission, services, start), distinct from the API errors in `error`. */
  deviceError: 'PERMISSION_DENIED' | 'SERVICES_DISABLED' | 'START_FAILED' | null;
}

export interface ServiceLabels {
  notificationTitle: string;
  notificationBody: string;
}

export interface CurrentFix {
  latitude: number;
  longitude: number;
  accuracyM?: number | undefined;
}

type Listener = (s: TrackerState) => void;

async function loadQueue(): Promise<Sample[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  return Array.isArray(parsed) ? (parsed as Sample[]) : [];
}

async function saveQueue(queue: Sample[]): Promise<void> {
  if (queue.length === 0) await AsyncStorage.removeItem(QUEUE_KEY);
  else await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

function rawFix(loc: Location.LocationObject): RawFix {
  return {
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    heading: loc.coords.heading,
    speed: loc.coords.speed,
    timestamp: loc.timestamp,
  };
}

class Tracker {
  readonly core = new TrackerCore({
    ping: (sample) => api<TrackingPingResultDto>('/tracking/ping', { method: 'POST', body: sample }),
    pingBatch: (points) => api<TrackingBatchResultDto>('/tracking/ping/batch', { method: 'POST', body: { points } }),
    loadQueue,
    saveQueue,
  });
  private device: Pick<TrackerState, 'mode' | 'permission' | 'deviceError'> = { mode: 'off', permission: 'unknown', deviceError: null };
  private listeners = new Set<Listener>();
  private watch: Location.LocationSubscription | null = null;
  private appState: NativeEventSubscription | null = null;
  private starting: Promise<void> | null = null;
  private seenRejected = 0;

  constructor() {
    this.core.subscribe((s) => {
      // The API says this trip is not tracked (session closed by COMPLETED / CANCELLED while the
      // app was away, or not the driver's trip): stop the service rather than stream refusals.
      if (s.active && s.rejected !== this.seenRejected) {
        this.seenRejected = s.rejected;
        if (s.lastRejection === 'TRACKING_SESSION_NOT_ACTIVE' || s.lastRejection === 'NOT_FOUND') void this.stop();
      }
      this.emit();
    });
  }

  get snapshot(): TrackerState {
    return { ...this.core.snapshot, ...this.device };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit(): void {
    const s = this.snapshot;
    for (const l of this.listeners) l(s);
  }

  private setDevice(patch: Partial<typeof this.device>): void {
    this.device = { ...this.device, ...patch };
    this.emit();
  }

  /** The current permission state without prompting (for the account screen). */
  async refreshPermission(): Promise<LocationPermission> {
    try {
      const fg = await Location.getForegroundPermissionsAsync();
      if (!fg.granted) {
        this.setDevice({ permission: fg.canAskAgain ? 'unknown' : 'denied' });
        return this.device.permission;
      }
      if (isExpoGo()) {
        this.setDevice({ permission: 'foreground' });
        return 'foreground';
      }
      const bg = await Location.getBackgroundPermissionsAsync();
      this.setDevice({ permission: bg.granted ? 'background' : 'foreground' });
      return this.device.permission;
    } catch {
      return this.device.permission;
    }
  }

  /** Foreground first, then background; returns what was granted. Never throws. */
  private async requestPermissions(): Promise<LocationPermission> {
    let fg = await Location.getForegroundPermissionsAsync();
    if (!fg.granted && fg.canAskAgain) fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) {
      this.setDevice({ permission: 'denied', deviceError: 'PERMISSION_DENIED' });
      return 'denied';
    }
    if (isExpoGo()) {
      this.setDevice({ permission: 'foreground', deviceError: null });
      return 'foreground';
    }
    let bg = await Location.getBackgroundPermissionsAsync();
    if (!bg.granted && bg.canAskAgain) bg = await Location.requestBackgroundPermissionsAsync();
    const granted: LocationPermission = bg.granted ? 'background' : 'foreground';
    this.setDevice({ permission: granted, deviceError: null });
    return granted;
  }

  /**
   * Starts streaming for a trip. Idempotent for the same trip; a different trip replaces the
   * running one. The labels feed the Android foreground-service notification.
   */
  async start(tripId: string, labels: ServiceLabels): Promise<void> {
    if (this.core.snapshot.active && this.core.snapshot.tripId === tripId) return;
    if (this.starting) await this.starting;
    this.starting = this.doStart(tripId, labels).finally(() => {
      this.starting = null;
    });
    await this.starting;
  }

  private async doStart(tripId: string, labels: ServiceLabels): Promise<void> {
    await this.stop();
    await this.core.restore();
    try {
      if (!(await Location.hasServicesEnabledAsync())) {
        this.setDevice({ deviceError: 'SERVICES_DISABLED', mode: 'off' });
        return;
      }
    } catch {
      /* iOS answers through the permission path instead */
    }
    const permission = await this.requestPermissions();
    if (permission === 'denied') return;

    await AsyncStorage.setItem(ACTIVE_KEY, tripId).catch(() => undefined);
    this.core.start(tripId);
    this.appState = AppState.addEventListener('change', this.onAppState);

    if (permission === 'background') {
      try {
        await Location.startLocationUpdatesAsync(LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: PING_INTERVAL_MS,
          distanceInterval: 5,
          deferredUpdatesInterval: PING_INTERVAL_MS,
          deferredUpdatesDistance: 0,
          activityType: Location.LocationActivityType.AutomotiveNavigation,
          pausesUpdatesAutomatically: false,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: labels.notificationTitle,
            notificationBody: labels.notificationBody,
            notificationColor: '#0a7050',
            killServiceOnDestroy: false,
          },
        });
        this.setDevice({ mode: 'background', deviceError: null });
        return;
      } catch (e) {
        console.warn(`[tracker] background updates unavailable, watching in the foreground: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await this.startForegroundWatch(isExpoGo() ? 'expo-go' : 'foreground');
  }

  private async startForegroundWatch(mode: TrackerMode): Promise<void> {
    try {
      this.watch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: PING_INTERVAL_MS, distanceInterval: 0 },
        (loc) => {
          void this.core.onFix(rawFix(loc));
        },
        () => {
          this.setDevice({ deviceError: 'START_FAILED' });
        },
      );
      this.setDevice({ mode, deviceError: null });
    } catch (e) {
      console.warn(`[tracker] foreground watch failed: ${e instanceof Error ? e.message : String(e)}`);
      this.setDevice({ mode: 'off', deviceError: 'START_FAILED' });
    }
  }

  /** Stops the watch / background task and the core; queued samples get one last flush. */
  async stop(): Promise<void> {
    this.watch?.remove();
    this.watch = null;
    this.appState?.remove();
    this.appState = null;
    try {
      if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    } catch {
      /* not registered on this runtime */
    }
    await AsyncStorage.removeItem(ACTIVE_KEY).catch(() => undefined);
    this.core.stop();
    this.setDevice({ mode: 'off' });
  }

  /** Samples delivered by the background task (possibly after a headless relaunch). */
  async onBackgroundLocations(locations: Location.LocationObject[]): Promise<void> {
    if (!locations.length) return;
    if (!this.core.snapshot.active) {
      // Headless start: the JS was relaunched by the OS for the task; pick the trip up again.
      const tripId = await AsyncStorage.getItem(ACTIVE_KEY).catch(() => null);
      if (!tripId) return;
      await this.core.restore();
      this.core.start(tripId);
      this.setDevice({ mode: 'background', permission: 'background' });
    }
    // Deferred delivery hands over a small burst; the newest fix is what the customer's map needs.
    const newest = locations.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    await this.core.onFix(rawFix(newest));
  }

  private onAppState = (s: AppStateStatus): void => {
    if (s === 'active') void this.core.flush();
  };

  /**
   * A position for a status transition: the agent's last sample when fresh, else one GPS read
   * (asks for the foreground permission if needed). Null when nothing is available — the
   * transition still goes through; the API records the position only when it is given.
   */
  async currentFix(): Promise<CurrentFix | null> {
    const last = this.core.snapshot.last;
    if (last && Date.now() - new Date(last.recordedAt).getTime() < FRESH_FIX_MS) {
      return { latitude: last.latitude, longitude: last.longitude, accuracyM: last.accuracyM };
    }
    try {
      let fg = await Location.getForegroundPermissionsAsync();
      if (!fg.granted && fg.canAskAgain) fg = await Location.requestForegroundPermissionsAsync();
      if (!fg.granted) {
        this.setDevice({ permission: 'denied' });
        return null;
      }
      const loc = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
        new Promise<null>((resolve) => {
          setTimeout(() => {
            resolve(null);
          }, ONE_SHOT_TIMEOUT_MS);
        }),
      ]);
      if (!loc) return null;
      const acc = loc.coords.accuracy;
      return { latitude: Number(loc.coords.latitude.toFixed(7)), longitude: Number(loc.coords.longitude.toFixed(7)), ...(acc !== null && Number.isFinite(acc) ? { accuracyM: Math.max(0, Math.round(acc)) } : {}) };
    } catch {
      return null;
    }
  }
}

let instance: Tracker | null = null;
export function tracker(): Tracker {
  instance ??= new Tracker();
  return instance;
}

// Must be defined in global scope, before any start, so the OS can call it after a headless launch.
if (!TaskManager.isTaskDefined(LOCATION_TASK)) {
  TaskManager.defineTask<{ locations?: Location.LocationObject[] } | null>(LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn(`[tracker] background task error: ${error.message}`);
      return;
    }
    await tracker().onBackgroundLocations(data?.locations ?? []);
  });
}
