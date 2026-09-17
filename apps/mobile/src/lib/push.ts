import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { config, platformClientType } from '@/config';
import { api } from '@/lib/api';
import { routeForNotification, routeForUrl, type DeepLinkContext, type DeepLinkRoute } from '@/lib/deep-link';
// Type-only: erased at build time, so Expo Go never loads the native module through this line.
import type * as NotificationsNs from 'expo-notifications';

/**
 * Push registration (api.md §8.26): after sign-in the device token goes to
 * `POST /notifications/devices { token, platform, appVersion }`; on sign-out the same token is
 * deactivated with `DELETE /notifications/devices/{token}`. A tapped notification is routed
 * through the same resolver the inbox uses (`data.bookingId` etc.).
 *
 * `expo-notifications` is loaded lazily and only outside Expo Go: since SDK 53 the module
 * throws at import time inside Expo Go on Android ("remote notifications were removed"), and an
 * import-time throw would take the whole `(app)` layout down with it. Development builds and
 * store builds load it normally; simulators have no token and resolve null quietly.
 */

type NotificationsModule = typeof NotificationsNs;

let registeredToken: string | null = null;

function easProjectIdOf(extra: unknown): string | undefined {
  if (typeof extra !== 'object' || extra === null) return undefined;
  const eas: unknown = (extra as { eas?: unknown }).eas;
  if (typeof eas !== 'object' || eas === null) return undefined;
  const id: unknown = (eas as { projectId?: unknown }).projectId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export function isExpoGo(): boolean {
  return Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
}

/** True when the notifications module can be loaded on this runtime (never in Expo Go, never on a simulator). */
export function pushAvailable(): boolean {
  return Device.isDevice && !isExpoGo();
}

async function notificationsModule(): Promise<NotificationsModule | null> {
  if (!pushAvailable()) return null;
  try {
    return await import('expo-notifications');
  } catch (e) {
    console.warn(`[push] module unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Permission → Android channel → token. Null in Expo Go, on a simulator, or when permission is refused. */
export async function registerPushToken(): Promise<string | null> {
  const Notifications = await notificationsModule();
  if (!Notifications) {
    if (isExpoGo())
      console.warn('[push] Expo Go cannot receive remote notifications — use a development build to test push');
    return null;
  }
  try {
    const current = await Notifications.getPermissionsAsync();
    const status = current.granted
      ? current.status
      : (await Notifications.requestPermissionsAsync()).status;
    if (status !== Notifications.PermissionStatus.GRANTED) return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const easProjectId = easProjectIdOf(Constants.expoConfig?.extra);
    const token: unknown = easProjectId
      ? (await Notifications.getExpoPushTokenAsync({ projectId: easProjectId })).data
      : // Without an EAS project (local dev build) fall back to the raw APNs/FCM device token.
        (await Notifications.getDevicePushTokenAsync()).data;
    return typeof token === 'string' ? token : JSON.stringify(token);
  } catch (e) {
    console.warn(`[push] token unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** Obtain the token and register it with the API. Safe to call repeatedly (the API upserts on `token`). */
export async function syncPushRegistration(): Promise<void> {
  const token = await registerPushToken();
  if (!token) return;
  const r = await api<unknown>('/notifications/devices', {
    method: 'POST',
    body: { token, platform: platformClientType(), appVersion: config.appVersion },
  });
  if (r.ok) registeredToken = token;
  else console.warn(`[push] device registration failed: ${r.error.code}`);
}

/** `DELETE /notifications/devices/{token}` — called before the session is revoked so the Bearer token is still valid. */
export async function unregisterPush(): Promise<void> {
  const token = registeredToken;
  registeredToken = null;
  if (!token) return;
  await api<unknown>(`/notifications/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(
    () => undefined,
  );
}

/** Where a notification payload (push `data`, or the deep-link URL some providers send) should take the app. */
export function routeForPushData(data: Record<string, unknown> | null | undefined, ctx?: DeepLinkContext): DeepLinkRoute {
  const url = data?.['url'];
  if (typeof url === 'string') {
    const fromUrl = routeForUrl(url, ctx);
    if (fromUrl) return fromUrl;
  }
  return routeForNotification(data, ctx);
}

/**
 * Subscribes to tapped notifications (foreground/background) and delivers the cold-start tap.
 * Returns the unsubscribe function; a no-op where push is unavailable.
 */
export async function watchNotificationTaps(
  onRoute: (route: DeepLinkRoute) => void,
  /** Evaluated at tap time (the profile may load after the subscription). */
  context: () => DeepLinkContext = () => ({ driver: false }),
): Promise<() => void> {
  const Notifications = await notificationsModule();
  if (!Notifications) return () => undefined;
  const dataOf = (r: { notification: { request: { content: { data?: unknown } } } }) => {
    const d: unknown = r.notification.request.content.data;
    return typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : null;
  };
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    onRoute(routeForPushData(dataOf(response), context()));
  });
  const tokenSub = Notifications.addPushTokenListener(() => {
    // The provider rotated the token: re-register so the API keeps a live one.
    void syncPushRegistration();
  });
  try {
    const last = Notifications.getLastNotificationResponse();
    if (last) onRoute(routeForPushData(dataOf(last), context()));
  } catch {
    /* no cold-start tap */
  }
  return () => {
    sub.remove();
    tokenSub.remove();
  };
}
