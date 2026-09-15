'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Bell } from 'lucide-react';
import type { NotificationDto, NotificationUnreadCountDto } from '@unigate/types';
import { api } from '@/lib/api-client';
import { Link, useRouter } from '@/lib/i18n/routing';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { notificationHref } from './deep-link';

const POLL_MS = 60_000;

/** Header bell: unread badge polled as the socket fallback (api.md §8.26), the latest few on open, one click marks read and deep-links. */
export function NotificationBell() {
  const t = useTranslations('portal.notifications');
  const router = useRouter();
  const [unread, setUnread] = useState<NotificationUnreadCountDto | null>(null);
  const [latest, setLatest] = useState<NotificationDto[]>([]);

  const refreshCount = useCallback(async () => {
    const res = await api<NotificationUnreadCountDto>('/notifications/unread-count');
    if (res.ok) setUnread(res.data);
  }, []);
  useEffect(() => {
    void refreshCount();
    const t1 = setInterval(() => void refreshCount(), POLL_MS);
    return () => { clearInterval(t1); };
  }, [refreshCount]);

  async function open(isOpen: boolean) {
    if (!isOpen) return;
    const res = await api<NotificationDto[]>('/notifications', { query: { pageSize: 8 } });
    if (res.ok) setLatest(res.data);
  }
  async function pick(n: NotificationDto) {
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' });
    await refreshCount();
    router.push(notificationHref(n) ?? '/notifications');
  }

  return (
    <DropdownMenu onOpenChange={(o) => void open(o)}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('bell', { n: unread?.total ?? 0 })} className="relative">
          <Bell className="size-5" />
          {unread && unread.total > 0 && (
            <span className="absolute -end-0.5 -top-0.5 min-w-4 rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-destructive-foreground" dir="ltr">{unread.total > 99 ? '99+' : unread.total}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>{t('title')}</span>
          <Link href="/notifications" className="text-xs font-normal text-primary hover:underline">{t('viewAll')}</Link>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {latest.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">{t('empty')}</div>
        ) : (
          latest.map((n) => (
            <DropdownMenuItem key={n.id} className="flex flex-col items-start gap-0.5" onSelect={() => void pick(n)}>
              <span className={n.readAt ? 'text-sm' : 'text-sm font-medium'}>{n.title ?? n.templateCode}</span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{n.body}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
