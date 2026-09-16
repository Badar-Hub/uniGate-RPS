import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * M0: obtain a push token and log it — nothing is sent to the API yet (device registration,
 * `POST /me/devices`, lands in M1 together with the notifications channel work).
 *
 * `expo-notifications` is loaded lazily and only outside Expo Go: since SDK 53 the module
 * throws at import time inside Expo Go on Android ("remote notifications were removed"), and an
 * import-time throw would take the whole `(app)` layout down with it. Development builds and
 * store builds load it normally; simulators have no token and resolve null quietly.
 */
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

export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  if (isExpoGo()) {
    console.warn('[push] Expo Go cannot receive remote notifications — use a development build to test push');
    return null;
  }
  try {
    const Notifications = await import('expo-notifications');
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
    const value = typeof token === 'string' ? token : JSON.stringify(token);
    console.warn(`[push] device token (M0: logged only, not registered): ${value}`);
    return value;
  } catch (e) {
    console.warn(`[push] token unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
