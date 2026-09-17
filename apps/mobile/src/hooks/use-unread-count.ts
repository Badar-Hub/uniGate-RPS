import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useUnreadCountQuery } from '@/lib/queries';

const POLL_MS = 60_000;

/**
 * Unread badge for the Notifications tab (api.md §8.26 `GET /notifications/unread-count`):
 * polled every 60 s while the app is in the foreground — the same socket fallback the web bell
 * uses — and refetched the moment the app comes back to the foreground.
 */
export function useUnreadCount(enabled: boolean): number {
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  const q = useUnreadCountQuery(enabled);
  const refetch = q.refetch;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setForeground(active);
      if (active && enabled) void refetch();
    });
    return () => {
      sub.remove();
    };
  }, [enabled, refetch]);

  useEffect(() => {
    if (!enabled || !foreground) return;
    const id = setInterval(() => void refetch(), POLL_MS);
    return () => {
      clearInterval(id);
    };
  }, [enabled, foreground, refetch]);

  return q.data?.total ?? 0;
}
