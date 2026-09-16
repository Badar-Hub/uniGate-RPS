import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * API base URL as reachable from the phone. `EXPO_PUBLIC_API_URL` is inlined at bundle time
 * (restart `expo start` after changing it); the default is the LAN address the API is served on
 * for hands-on testing with Expo Go — see docs/mobile-app.md. Only the base URL lives here:
 * business values come from the API's settings catalogue, never from app config.
 */
const DEFAULT_API_URL = 'http://172.23.65.81:4000/api/v1';
const apiUrl = (process.env['EXPO_PUBLIC_API_URL'] ?? DEFAULT_API_URL).replace(/\/+$/, '');

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'UniGate',
  slug: 'unigate',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  // Deep links: unigate://… (and the universal links added in M1).
  scheme: 'unigate',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'sa.unigate.app',
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: 'sa.unigate.app',
    adaptiveIcon: {
      backgroundColor: '#0a7050',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // Arabic is the primary locale: the native shells must allow RTL layout.
    ['expo-localization', { supportsRTL: true }],
    [
      'expo-splash-screen',
      { backgroundColor: '#0a7050', image: './assets/images/splash-icon.png', imageWidth: 120 },
    ],
    ['expo-notifications', { color: '#0a7050' }],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl,
  },
});
