import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context propagated through AsyncLocalStorage so the logger, audit writer and
 * outbox can read the request id without threading it through every signature.
 */
export interface RequestContext {
  requestId: string;
  userId: string | null;
  sessionId: string | null;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string {
  return storage.getStore()?.requestId ?? 'no-request';
}

export function setContextUser(userId: string, sessionId: string | null): void {
  const ctx = storage.getStore();
  if (ctx) {
    ctx.userId = userId;
    ctx.sessionId = sessionId;
  }
}
