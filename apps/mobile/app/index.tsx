import { Redirect } from 'expo-router';
import { Loading } from '@/components/ui';
import { useSession } from '@/lib/session';

/** Entry: wait for the session bootstrap, then land in the right group. */
export default function Index() {
  const { status } = useSession();
  if (status === 'loading') return <Loading />;
  return <Redirect href={status === 'signedIn' ? '/(app)' : '/(auth)/login'} />;
}
