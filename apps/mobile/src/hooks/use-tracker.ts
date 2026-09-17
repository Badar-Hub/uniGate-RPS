import { useEffect, useState } from 'react';
import { tracker, type TrackerState } from '@/lib/driver/tracker';

/** The location agent's state for a screen: subscribes on mount, unsubscribes on unmount. */
export function useTracker(): TrackerState {
  const [state, setState] = useState<TrackerState>(() => tracker().snapshot);
  useEffect(() => tracker().subscribe(setState), []);
  return state;
}
