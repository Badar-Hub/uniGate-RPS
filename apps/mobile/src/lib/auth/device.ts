import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import type { DeviceInfo } from '@unigate/api-client';

const DEVICE_ID_KEY = 'unigate.deviceId';

let cached: string | null = null;

/**
 * A stable per-install UUID (api.md §8.1 `deviceId`): generated once, kept in the keystore so
 * `GET /me/sessions` shows one row per device instead of one per login. It is not a hardware
 * identifier and changes on reinstall.
 */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await SecureStore.getItemAsync(DEVICE_ID_KEY).catch(() => null);
  if (stored) {
    cached = stored;
    return stored;
  }
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id).catch(() => undefined);
  cached = id;
  return id;
}

/** Display-only device label, e.g. "Apple iPhone 15" / "samsung SM-S911B"; sanitised server-side. */
export function getDeviceName(): string {
  const parts = [Device.manufacturer, Device.modelName].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  );
  const name = parts.length ? parts.join(' ') : (Device.deviceName ?? 'Mobile device');
  return name.slice(0, 160);
}

export async function deviceInfo(): Promise<Required<DeviceInfo>> {
  return { deviceId: await getDeviceId(), deviceName: getDeviceName() };
}
