import { createApiClient, refresh as refreshCall, type ApiError } from '@unigate/api-client';
import { config, platformClientType } from '@/config';
import { sessionEvents } from '@/lib/auth/events';
import { tokens } from '@/lib/auth/tokens';
import { currentLocale } from '@/i18n/locale';

/**
 * The one API client for the app (api.md §6.2 mobile mode). Refresh flow: on a 401
 * AUTH_TOKEN_EXPIRED the client calls `refreshSession` once — `POST /auth/refresh
 * { refreshToken }` — stores the rotated pair and retries the original request; if that fails
 * the tokens are cleared and `onUnauthorized` sends the app back to the login screen.
 */
async function refreshSession(): Promise<boolean> {
  const refreshToken = await tokens.getRefresh();
  if (!refreshToken) return false;
  const result = await refreshCall(client, refreshToken);
  if (!result.ok) {
    // Reuse detection / expiry / revocation: the family is dead, drop what we hold (api.md §6.3).
    if (result.error.status === 401 || result.error.status === 403) await tokens.clear();
    return false;
  }
  await tokens.setPair(result.data.tokens);
  return true;
}

async function onUnauthorized(_error: ApiError): Promise<void> {
  await tokens.clear();
  sessionEvents.emitSignedOut();
}

export const client = createApiClient({
  baseUrl: config.apiUrl,
  clientType: platformClientType(),
  getAccessToken: () => tokens.getAccess(),
  refreshSession,
  onUnauthorized,
  headers: () => ({ 'Accept-Language': currentLocale() }),
});

export const api = client.api;

/** An `ApiError` as a throwable, so TanStack Query treats a failed envelope as a query error. */
export class ApiRequestError extends Error {
  constructor(readonly error: ApiError) {
    super(`${error.code} (${error.status})`);
    this.name = 'ApiRequestError';
  }
}

export function apiErrorOf(e: unknown): ApiError | null {
  return e instanceof ApiRequestError ? e.error : null;
}

export async function fetchOrThrow<T>(...args: Parameters<typeof api>): Promise<T> {
  const r = await api<T>(...args);
  if (!r.ok) throw new ApiRequestError(r.error);
  return r.data;
}
