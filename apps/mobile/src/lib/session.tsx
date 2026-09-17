import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { logout as logoutCall, me as meCall, type MobileAuthResult } from '@unigate/api-client';
import type { MeDto } from '@unigate/types';
import { ApiRequestError, client } from '@/lib/api';
import { sessionEvents } from '@/lib/auth/events';
import { tokens } from '@/lib/auth/tokens';
import { unregisterPush } from '@/lib/push';
import { disconnectRealtime } from '@/lib/realtime';
import { audienceOf, type Audience } from '@/lib/tabs';

export type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionContextValue {
  status: SessionStatus;
  /** `GET /me` — null until loaded. */
  me: MeDto | null;
  audience: Audience;
  /** Permission check on the resolved permission set (api.md §6.5). */
  can: (code: string) => boolean;
  /** Store a fresh token pair from login / OTP verify and load `/me`. */
  signIn: (result: MobileAuthResult) => Promise<void>;
  /** `POST /auth/logout`, then forget the tokens whatever the API said. */
  signOut: () => Promise<void>;
  refetchMe: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const ME_QUERY_KEY = ['me'] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');

  // Cold start: an access token is never persisted, so a stored refresh token is exchanged
  // first (one call, shared with any request that races it) and `/me` follows.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const refreshToken = await tokens.getRefresh();
      if (!refreshToken) {
        if (!cancelled) setStatus('signedOut');
        return;
      }
      // `/me` triggers the refresh through the client's 401 path; a dead family lands in onUnauthorized.
      const r = await meCall(client);
      if (cancelled) return;
      if (r.ok) {
        queryClient.setQueryData(ME_QUERY_KEY, r.data);
        setStatus('signedIn');
      } else {
        await tokens.clear();
        setStatus('signedOut');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  useEffect(
    () =>
      sessionEvents.onSignedOut(() => {
        disconnectRealtime();
        queryClient.clear();
        setStatus('signedOut');
      }),
    [queryClient],
  );

  const meQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: async () => {
      const r = await meCall(client);
      if (!r.ok) throw new ApiRequestError(r.error);
      return r.data;
    },
    enabled: status === 'signedIn',
    staleTime: 5 * 60 * 1000,
  });

  const signIn = useCallback(
    async (result: MobileAuthResult) => {
      await tokens.setPair(result.tokens);
      const r = await meCall(client);
      if (!r.ok) {
        await tokens.clear();
        throw new ApiRequestError(r.error);
      }
      queryClient.setQueryData(ME_QUERY_KEY, r.data);
      setStatus('signedIn');
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    // Deactivate the push token while the access token is still valid, then revoke the session.
    await unregisterPush();
    disconnectRealtime();
    try {
      await logoutCall(client);
    } catch {
      /* the server-side revoke is best effort; the local tokens go regardless */
    }
    await tokens.clear();
    queryClient.clear();
    setStatus('signedOut');
  }, [queryClient]);

  const refetchMe = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  const me = meQuery.data ?? null;
  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      me,
      audience: audienceOf(me),
      can: (code: string) => me?.permissions.includes(code) ?? false,
      signIn,
      signOut,
      refetchMe,
    }),
    [status, me, signIn, signOut, refetchMe],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
