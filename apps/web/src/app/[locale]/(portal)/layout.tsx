import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/auth/session-provider';
import { PortalShell } from '@/components/portal/portal-shell';

/** Everything under (portal) requires a session; the shell redirects to /login when /me fails. */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <PortalShell>{children}</PortalShell>
    </SessionProvider>
  );
}
