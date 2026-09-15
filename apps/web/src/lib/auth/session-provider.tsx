'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MeDto } from '@unigate/types';
import { api } from '@/lib/api-client';

/**
 * The single /me call the web app makes on boot (api.md §8.2). `me` is null when signed out.
 * Authorization decisions in the UI are cosmetic only — the API enforces every one of them.
 */
interface SessionState {
  me: MeDto | null;
  loading: boolean;
  reload: () => Promise<MeDto | null>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children, initialMe = null }: { children: ReactNode; initialMe?: MeDto | null }) {
  const [me, setMe] = useState<MeDto | null>(initialMe);
  const [loading, setLoading] = useState(initialMe === null);

  const reload = useCallback(async () => {
    setLoading(true);
    const res = await api<MeDto>('/me');
    const next = res.ok ? res.data : null;
    setMe(next);
    setLoading(false);
    return next;
  }, []);

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST', retryOnExpired: false });
    setMe(null);
  }, []);

  useEffect(() => {
    if (initialMe === null) void reload();
  }, [initialMe, reload]);

  const value = useMemo<SessionState>(
    () => ({ me, loading, reload, signOut, can: (p) => Boolean(me?.permissions.includes(p) ?? me?.permissions.includes(`${p}_any`)) }),
    [me, loading, reload, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
