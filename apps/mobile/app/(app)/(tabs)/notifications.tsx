import { useState } from 'react';
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import type { NotificationDto } from '@unigate/types';
import {
  Button,
  Chip,
  Empty,
  ErrorBanner,
  IconButton,
  Loading,
  Screen,
  Title,
  usePalette,
} from '@/components/ui';
import { useAction } from '@/hooks/use-action';
import { useI18n } from '@/i18n';
import { api, ApiRequestError, apiErrorOf } from '@/lib/api';
import { routeForNotification } from '@/lib/deep-link';
import { formatDateTime } from '@/lib/format';
import { keys } from '@/lib/queries';
import { enumLabel } from '@/lib/status';

/**
 * In-app inbox (api.md §8.26): cursor-paginated `GET /notifications`, unread filter, mark read
 * / read all, delete, and a tap that marks the row read and follows its deep link.
 */
export default function NotificationsScreen() {
  const { t, has, errorMessage, locale, isRTL } = useI18n();
  const colors = usePalette();
  const router = useRouter();
  const qc = useQueryClient();
  const action = useAction();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const q = useInfiniteQuery({
    queryKey: [...keys.notifications, 'inbox', { unreadOnly }],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const r = await api<NotificationDto[]>('/notifications', {
        query: { pageSize: 20, ...(unreadOnly ? { unreadOnly: true } : {}), ...(pageParam ? { cursor: pageParam } : {}) },
      });
      if (!r.ok) throw new ApiRequestError(r.error);
      return { items: r.data, nextCursor: typeof r.meta.nextCursor === 'string' ? r.meta.nextCursor : null };
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  const refresh = () => Promise.all([q.refetch(), qc.invalidateQueries({ queryKey: keys.unreadCount })]);

  const markRead = async (n: NotificationDto) => {
    if (n.readAt) return;
    await api(`/notifications/${n.id}/read`, { method: 'POST' });
    void refresh();
  };
  const open = (n: NotificationDto) => {
    void markRead(n);
    const route = routeForNotification(n.data);
    if (route.kind !== 'inbox') router.push(route.path);
  };
  const readAll = async () => {
    const r = await action.run(() => api('/notifications/read-all', { method: 'POST', body: {} }));
    if (r !== null) void refresh();
  };
  const remove = async (n: NotificationDto) => {
    const r = await action.run(() => api(`/notifications/${n.id}`, { method: 'DELETE' }));
    if (r !== null) void refresh();
  };

  return (
    <Screen>
      <View className="flex-row items-center justify-between py-3">
        <Title>{t('lists.notifications')}</Title>
        <IconButton icon="checkmark-done" label={t('notifications.readAll')} onPress={() => void readAll()} disabled={action.busy} />
      </View>
      <View className="flex-row">
        <Chip label={t('common.all')} active={!unreadOnly} onPress={() => { setUnreadOnly(false); }} />
        <Chip label={t('notifications.unreadOnly')} active={unreadOnly} onPress={() => { setUnreadOnly(true); }} />
      </View>
      <ErrorBanner message={action.banner} />
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <View>
          <ErrorBanner message={errorMessage(apiErrorOf(q.error))} />
          <Button title={t('common.retry')} variant="secondary" onPress={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(n) => n.id}
          refreshControl={
            <RefreshControl refreshing={q.isRefetching && !q.isFetchingNextPage} onRefresh={() => void refresh()} tintColor={colors.primary} />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          ListEmptyComponent={<Empty text={t('common.empty')} />}
          ListFooterComponent={q.isFetchingNextPage ? <Loading /> : <View className="h-6" />}
          contentContainerClassName="pb-6"
          renderItem={({ item: n }) => {
            const route = routeForNotification(n.data);
            return (
              <Pressable
                accessibilityRole="button"
                onPress={() => { open(n); }}
                className={`mb-2 rounded-lg border border-border p-3 active:opacity-80 ${n.readAt ? 'bg-card' : 'bg-primary/5'}`}
              >
                <View className="flex-row items-start gap-3">
                  {!n.readAt ? <View className="mt-2 h-2 w-2 rounded-full bg-primary" /> : <View className="mt-2 h-2 w-2" />}
                  <View className="flex-1">
                    <Text className={`text-base text-card-foreground text-start ${n.readAt ? '' : 'font-semibold'}`}>
                      {n.title ?? n.templateCode}
                    </Text>
                    <Text className="mt-0.5 text-sm text-muted-foreground text-start">{n.body}</Text>
                    <View className="mt-1 flex-row flex-wrap items-center gap-2">
                      <Text className="text-xs text-muted-foreground">{enumLabel({ t, has }, 'notificationCategory', n.category)}</Text>
                      <Text className="text-xs text-muted-foreground" style={{ writingDirection: 'ltr' }}>
                        {formatDateTime(n.createdAt, locale)}
                      </Text>
                      {route.kind !== 'inbox' ? (
                        <Text className="text-xs font-medium text-primary">{t('notifications.open')}</Text>
                      ) : null}
                    </View>
                  </View>
                  <View className="flex-row">
                    {!n.readAt ? (
                      <IconButton icon="checkmark" label={t('notifications.markRead')} onPress={() => void markRead(n)} />
                    ) : null}
                    <IconButton icon="trash-outline" label={t('notifications.remove')} onPress={() => void remove(n)} disabled={action.busy} />
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={16}
                    color={colors.mutedForeground}
                    style={{ marginTop: 12, transform: [{ scaleX: isRTL ? -1 : 1 }], opacity: route.kind === 'inbox' ? 0 : 1 }}
                  />
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
}
