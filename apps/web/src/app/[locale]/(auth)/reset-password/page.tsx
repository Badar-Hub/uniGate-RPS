import { setRequestLocale } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/auth/password-forms';

export default async function ResetPasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token } = await searchParams;
  return <ResetPasswordForm token={token ?? null} />;
}
