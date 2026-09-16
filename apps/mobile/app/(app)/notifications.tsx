import type { NotificationDto } from '@unigate/types';
import { ListScreen } from '@/components/list-screen';
import { useI18n } from '@/i18n';

/** In-app inbox, cursor-paginated (`GET /notifications`, api.md §5.2 / §8.26) — first page only in M0. */
export default function NotificationsScreen() {
  const { t } = useI18n();
  return (
    <ListScreen<NotificationDto>
      title={t('lists.notifications')}
      queryKey={['notifications', { first: true }]}
      path="/notifications"
      query={{ pageSize: 20 }}
      toRow={(n) => ({
        id: n.id,
        title: n.title ?? n.templateCode,
        subtitle: n.body,
        status: n.readAt ? t('lists.read') : t('lists.unread'),
        date: n.createdAt,
      })}
    />
  );
}
