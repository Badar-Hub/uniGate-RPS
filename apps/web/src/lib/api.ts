/** Base URL of the API. Only referrer-restricted public keys ever live in NEXT_PUBLIC_*. */
const configured = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');

/**
 * In the browser the API host follows the host the page was opened on (localhost, a LAN IP, a
 * hostname) when the configured URL is a plain host:port — the session cookies are SameSite,
 * so the portal and the API must be the same site whichever address the tester used.
 */
function base(): string {
  if (typeof window === 'undefined') return configured;
  try {
    const u = new URL(configured);
    if (u.hostname === window.location.hostname) return configured;
    if (u.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) {
      u.hostname = window.location.hostname;
      return u.toString().replace(/\/$/, '');
    }
  } catch {
    /* fall through to the configured value */
  }
  return configured;
}

export function apiUrl(path: string): string {
  return `${base()}${path.startsWith('/') ? path : `/${path}`}`;
}
