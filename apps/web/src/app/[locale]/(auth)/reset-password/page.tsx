import { setRequestLocale } from 'next-intl/server';
import { ResetPasswordForm } from '@/components/auth/password-forms';

export default async function ResetPasswordPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token } = await searchParams;
  // Mail clients and chat apps often glue the sentence's full stop or a closing bracket onto the link.
  const clean = token?.replace(/[.,;:)\]]+$/u, '') ?? null;
  return <ResetPasswordForm token={clean} />;
}
