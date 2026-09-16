/** Minimal listener set so the API client (a plain module) can tell the React session it lost auth. */
type Listener = () => void;

const listeners = new Set<Listener>();

export const sessionEvents = {
  onSignedOut(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  emitSignedOut(): void {
    for (const l of listeners) l();
  },
};
