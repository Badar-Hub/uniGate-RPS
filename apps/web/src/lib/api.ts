/** Base URL of the API. Only referrer-restricted public keys ever live in NEXT_PUBLIC_*. */
const base = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');

export function apiUrl(path: string): string {
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
