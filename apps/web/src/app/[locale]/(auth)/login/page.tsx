import { setRequestLocale } from 'next-intl/server';
import { LoginForm } from '@/components/auth/login-form';

export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { next } = await searchParams;
  // Only same-origin relative paths are honoured as a post-login destination.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  return <LoginForm next={safeNext} />;
}
