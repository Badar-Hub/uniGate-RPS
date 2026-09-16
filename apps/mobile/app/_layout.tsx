import '../global.css';

import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { I18nProvider, useI18n } from '@/i18n';
import { SessionProvider, useSession } from '@/lib/session';
import { palette } from '@/theme/tokens';

void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30 * 1000, refetchOnWindowFocus: false },
  },
});

function Root() {
  const { ready } = useI18n();
  const { status } = useSession();
  const { colorScheme } = useColorScheme();
  const colors = colorScheme === 'dark' ? palette.dark : palette.light;

  useEffect(() => {
    if (ready && status !== 'loading') void SplashScreen.hideAsync();
  }, [ready, status]);

  return (
    <>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <SessionProvider>
            <Root />
          </SessionProvider>
        </I18nProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
