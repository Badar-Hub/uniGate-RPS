'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import type { Envelope, ReadinessDto } from '@unigate/types';
import { apiUrl } from '@/lib/api';

type State = 'checking' | 'up' | 'down';

/**
 * Calls GET /ready on the API. Demonstrates the client → API contract (envelope, DTO types
 * from @unigate/types) and a logical-property layout that mirrors correctly in RTL.
 */
export function PlatformStatus({
  labels,
}: {
  labels: { status: string; healthy: string; down: string; checking: string };
}) {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(apiUrl('/ready'), { signal: ctrl.signal })
      .then((r) => r.json() as Promise<Envelope<ReadinessDto>>)
      .then((env) => {
        setState(env.success && env.data.ready ? 'up' : 'down');
      })
      .catch(() => {
        setState('down');
      });
    return () => {
      ctrl.abort();
    };
  }, []);

  const Icon = state === 'checking' ? Loader2 : state === 'up' ? CheckCircle2 : XCircle;
  const tone =
    state === 'checking' ? 'text-muted-foreground' : state === 'up' ? 'text-primary' : 'text-destructive';
  const label = state === 'checking' ? labels.checking : state === 'up' ? labels.healthy : labels.down;

  return (
    <div
      className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-card-foreground shadow-sm"
      role="status"
      aria-live="polite"
    >
      <Icon className={`size-5 ${tone} ${state === 'checking' ? 'animate-spin' : ''}`} aria-hidden />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{labels.status}</span>
        <span className="text-sm font-medium">{label}</span>
      </div>
    </div>
  );
}
