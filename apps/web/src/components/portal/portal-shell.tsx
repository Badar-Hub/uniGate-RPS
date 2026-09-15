'use client';

import { useEffect, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CalendarCheck2, CarFront, Smartphone, ClipboardList, FileCheck2, FileText, Gavel, LayoutDashboard, Loader2, LogOut, Percent, Receipt, Sparkles, Truck, UserCircle2, Users, Wallet, WalletCards } from 'lucide-react';
import { useSession } from '@/lib/auth/session-provider';
import { Link, usePathname, useRouter } from '@/lib/i18n/routing';
import { cn } from '@/lib/utils';
import { LanguageSwitch } from '@/components/language-switch';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * Portal chrome: sidebar navigation filtered by what /me says the actor may do (cosmetic — the
 * API is the authority), header with language switch and sign-out, and a sign-in redirect when
 * there is no session.
 */
export function PortalShell({ children }: { children: ReactNode }) {
  const { me, loading, can, signOut } = useSession();
  const t = useTranslations('portal.nav');
  const tc = useTranslations('common');
  const tp = useTranslations('portal');
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !me) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, me, router, pathname]);

  if (loading || !me) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted-foreground">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        <span className="ms-2 text-sm">{tc('loading')}</span>
      </div>
    );
  }

  const items: { href: string; label: string; icon: typeof LayoutDashboard; show: boolean }[] = [
    { href: '/dashboard', label: t('dashboard'), icon: LayoutDashboard, show: true },
    { href: '/documents', label: t('documents'), icon: FileText, show: can('documents.read') },
    { href: '/requests', label: t('requests'), icon: ClipboardList, show: Boolean(me.profiles.customer) || can('trip_requests.read_any') },
    { href: '/opportunities', label: t('opportunities'), icon: Sparkles, show: Boolean(me.profiles.owner) },
    { href: '/bids', label: t('bids'), icon: Gavel, show: Boolean(me.profiles.owner) || can('bids.read_any') },
    { href: '/bookings', label: t('bookings'), icon: CalendarCheck2, show: can('bookings.read') },
    { href: '/driver', label: t('driverApp'), icon: Smartphone, show: Boolean(me.profiles.driver) },
    { href: '/fleet', label: t('fleet'), icon: CarFront, show: Boolean(me.profiles.owner) || can('vehicles.read_any') },
    { href: '/settlements', label: t('settlements'), icon: Wallet, show: Boolean(me.profiles.owner) || can('settlements.create') },
    { href: '/invoices', label: t('invoices'), icon: Receipt, show: Boolean(me.profiles.customer) || can('invoices.issue') },
    { href: '/expenses', label: t('expenses'), icon: WalletCards, show: Boolean(me.profiles.owner) || can('expenses.read_any') },
    { href: '/admin/commissions', label: t('commissions'), icon: Percent, show: can('commissions.manage') },
    { href: '/admin/owners', label: t('adminReview'), icon: FileCheck2, show: can('owners.approve') },
    { href: '/admin/vehicles', label: t('vehicleApprovals'), icon: Truck, show: can('vehicles.approve') },
    { href: '/admin/customers', label: t('customers'), icon: Users, show: false },
  ];

  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 border-e bg-card md:flex md:flex-col">
        <div className="flex h-14 items-center border-b px-4 text-lg font-semibold">{tc('appName')}</div>
        <nav className="flex-1 space-y-1 p-2" aria-label="primary">
          {items
            .filter((i) => i.show)
            .map((i) => {
              const base = i.href.split('?')[0] ?? i.href;
              const active = pathname === base || pathname.startsWith(`${base}/`);
              return (
                <Link key={i.href} href={i.href} className={cn('flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent hover:text-accent-foreground', active && 'bg-accent text-accent-foreground font-medium')}>
                  <i.icon className="size-4" aria-hidden />
                  {i.label}
                </Link>
              );
            })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-background px-4">
          <span className="text-sm text-muted-foreground md:hidden">{tc('appName')}</span>
          <span className="hidden text-sm text-muted-foreground md:inline">{tp('welcome', { name: me.fullNameEn })}</span>
          <div className="flex items-center gap-1">
            <LanguageSwitch />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={me.fullNameEn}>
                  <UserCircle2 className="size-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>
                  <div className="text-sm">{me.fullNameEn}</div>
                  <div className="text-xs font-normal text-muted-foreground">{me.roles.join(' · ')}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    void signOut().then(() => { router.replace('/login'); });
                  }}
                >
                  <LogOut />
                  {tc('signOut')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="container flex-1 py-6">{children}</main>
      </div>
    </div>
  );
}
