import type { ReactNode } from 'react';

// Intentionally minimal: <html> and <body> are rendered by the [locale] layout so `lang` and
// `dir` are always correct for the request.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
