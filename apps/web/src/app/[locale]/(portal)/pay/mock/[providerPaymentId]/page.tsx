import { setRequestLocale } from 'next-intl/server';
import { MockCheckout } from '@/components/portal/mock-checkout';

/** The MockGateway's "hosted page" — lives in the app only because no real provider exists yet (ADR-005, OQ-03). */
export default async function Page({ params, searchParams }: { params: Promise<{ locale: string; providerPaymentId: string }>; searchParams: Promise<{ return?: string }> }) {
  const { locale, providerPaymentId } = await params;
  setRequestLocale(locale);
  const { return: returnUrl } = await searchParams;
  return <MockCheckout providerPaymentId={providerPaymentId} returnUrl={returnUrl ?? null} />;
}
