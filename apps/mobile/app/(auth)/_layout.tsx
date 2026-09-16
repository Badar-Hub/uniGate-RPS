import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/lib/session';

export default function AuthLayout() {
  const { status } = useSession();
  if (status === 'signedIn') return <Redirect href="/(app)" />;
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="otp" />
    </Stack>
  );
}
