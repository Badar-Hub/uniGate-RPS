import { useCallback, useEffect, useState } from 'react';

/** A ticking countdown for `Retry-After` / `resendAfterSeconds` (api.md §11: clients must honour it). */
export function useCooldown(): {
  seconds: number;
  start: (seconds: number) => void;
  active: boolean;
} {
  const [until, setUntil] = useState<number | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setSeconds(left);
      if (left === 0) setUntil(null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      clearInterval(id);
    };
  }, [until]);

  const start = useCallback((s: number) => {
    if (s > 0) setUntil(Date.now() + s * 1000);
  }, []);

  return { seconds, start, active: seconds > 0 };
}
