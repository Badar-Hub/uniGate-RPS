import { notFound } from 'next/navigation';

// Any path under a locale that no route matches renders the locale-aware not-found page.
export default function CatchAll() {
  notFound();
}
