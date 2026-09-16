import * as SecureStore from 'expo-secure-store';

/**
 * Token storage model (ADR-003, api.md §6.2 mobile mode):
 *  - the access token (15 min) lives in memory only — it is never persisted, so a cold start
 *    always goes through a refresh;
 *  - the refresh token (30 days, rotated on every use) lives in the OS keystore via
 *    expo-secure-store (Keychain on iOS, EncryptedSharedPreferences/Keystore on Android).
 */
const REFRESH_TOKEN_KEY = 'unigate.refreshToken';

let accessToken: string | null = null;

export const tokens = {
  getAccess(): string | null {
    return accessToken;
  },
  setAccess(token: string | null): void {
    accessToken = token;
  },
  getRefresh(): Promise<string | null> {
    return SecureStore.getItemAsync(REFRESH_TOKEN_KEY).catch(() => null);
  },
  async setRefresh(token: string): Promise<void> {
    await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, token, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },
  async setPair(pair: { accessToken: string; refreshToken: string }): Promise<void> {
    accessToken = pair.accessToken;
    await tokens.setRefresh(pair.refreshToken);
  },
  async clear(): Promise<void> {
    accessToken = null;
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => undefined);
  },
};
