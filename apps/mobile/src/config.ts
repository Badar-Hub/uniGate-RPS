import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { ClientType } from '@unigate/types';

/**
 * Runtime configuration. `extra.apiUrl` is set by app.config.ts from EXPO_PUBLIC_API_URL; the
 * direct env read is the fallback for tooling that evaluates this module without the config
 * (tests). Nothing else is configurable on the client — business values come from the API.
 */
const DEFAULT_API_URL = 'http://172.23.65.81:4000/api/v1';

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

const extra: unknown = Constants.expoConfig?.extra;
const fromExtra =
  typeof extra === 'object' && extra !== null
    ? str((extra as { apiUrl?: unknown }).apiUrl)
    : undefined;
const fromEnv = str(process.env['EXPO_PUBLIC_API_URL']);

export const config = {
  apiUrl: (fromExtra ?? fromEnv ?? DEFAULT_API_URL).replace(/\/+$/, ''),
  appVersion: Constants.expoConfig?.version ?? '0.0.0',
} as const;

/** The `clientType` the API keys token transport on (api.md §6.2). Web is never used by this app. */
export function platformClientType(): ClientType {
  return Platform.OS === 'ios' ? 'IOS' : 'ANDROID';
}
