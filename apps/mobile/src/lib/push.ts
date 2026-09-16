import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * M0: obtain a push token and log it — nothing is sent to the API yet (device registration,
 * `POST /me/devices`, lands in M1 together with the notifications channel work).
 *
 * Expo Go on Android (SDK 53+) no longer supports remote push; on a simulator there is no
 * token at all. Both cases resolve to null quietly so the app never blocks on push.
 */
function easProjectIdOf(extra: unknown): string | undefined {
  if (typeof extra !== 'object' || extra === null) return undefined;
  const eas: unknown = (extra as { eas?: unknown }).eas;
  if (typeof eas !== 'object' || eas === null) return undefined;
  const id: unknown = (eas as { projectId?: unknown }).projectId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
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
      : // Without an EAS project (Expo Go / local dev) fall back to the raw APNs/FCM device token.
        (await Notifications.getDevicePushTokenAsync()).data;
    const value = typeof token === 'string' ? token : JSON.stringify(token);
    console.warn(`[push] device token (M0: logged only, not registered): ${value}`);
    return value;
  } catch (e) {
    console.warn(`[push] token unavailable: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}
