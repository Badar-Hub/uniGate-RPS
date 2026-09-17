import type { ReactNode } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { Query } from '@unigate/api-client';
import { useI18n } from '@/i18n';
import { api, ApiRequestError, apiErrorOf } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/format';
import {
  Button,
  Card,
  Chip,
  Empty,
  ErrorBanner,
  Loading,
  Screen,
  StatusBadge,
  Title,
  usePalette,
  type Tone,
} from '@/components/ui';

export interface Row {
  id: string;
  /** e.g. the request / booking number. */
  title: string;
  subtitle?: string | undefined;
  status: string;
  tone?: Tone | undefined;
  /** ISO date shown formatted in the active locale. */
  date: string | null;
  dateLabel?: string | undefined;
  /** The date is a calendar day (invoice due date), not a timestamp. */
  dateOnly?: boolean | undefined;
  /** Trailing amount / note under the badge. */
  trailing?: string | undefined;
}

export interface Filter {
  value: string;
  label: string;
}

interface Props<T> {
  title: string;
  queryKey: readonly unknown[];
  path: string;
  query?: Query;
  toRow: (item: T) => Row;
  onPress?: ((item: T) => void) | undefined;
  /** Status chips rendered under the title; `''` is "all". */
  filters?: Filter[] | undefined;
  filter?: string | undefined;
  onFilter?: ((value: string) => void) | undefined;
  /** Right-hand header action (e.g. "New request"). */
  action?: ReactNode;
  /** Scrolls with the list, above the first row (a summary card). */
  above?: ReactNode;
  header?: boolean;
  pageSize?: number;
}

const PAGE_SIZE = 20;

/**
 * Offset-paginated list (api.md §5.1): pull-to-refresh, load-more on scroll end, filter chips,
 * number · status · date rows. Cursor lists (the inbox) have their own screen.
 */
export function ListScreen<T>({
  title,
  queryKey,
  path,
  query,
  toRow,
  onPress,
  filters,
  filter = '',
  onFilter,
  action,
  above,
  header = false,
  pageSize = PAGE_SIZE,
}: Props<T>) {
  const { t, errorMessage, locale, isRTL } = useI18n();
  const colors = usePalette();
  const q = useInfiniteQuery({
    queryKey: [...queryKey, { filter, pageSize }],
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const r = await api<T[]>(path, { query: { ...query, page: pageParam, pageSize } });
      if (!r.ok) throw new ApiRequestError(r.error);
      return { items: r.data, hasNext: r.meta.hasNext ?? false, page: pageParam };
    },
    getNextPageParam: (last) => (last.hasNext ? last.page + 1 : undefined),
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Screen header={header}>
      <View className="flex-row items-center justify-between py-3">
        <Title>{title}</Title>
        {action}
      </View>
      {filters && filters.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-1 flex-grow-0">
          {filters.map((f) => (
            <Chip
              key={f.value || '__all'}
              label={f.label}
              active={filter === f.value}
              onPress={() => onFilter?.(f.value)}
            />
          ))}
        </ScrollView>
      ) : null}
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
          keyExtractor={(item) => toRow(item).id}
          refreshControl={
            <RefreshControl
              refreshing={q.isRefetching && !q.isFetchingNextPage}
              onRefresh={() => void q.refetch()}
              tintColor={colors.primary}
            />
          }
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
          }}
          ListHeaderComponent={above ? <View>{above}</View> : null}
          ListEmptyComponent={<Empty text={t('common.empty')} />}
          ListFooterComponent={q.isFetchingNextPage ? <Loading /> : <View className="h-6" />}
          contentContainerClassName="pb-6"
          renderItem={({ item }) => {
            const row = toRow(item);
            const body = (
              <Card>
                <View className="flex-row items-center justify-between gap-2">
                  <Text
                    className="flex-1 text-base font-semibold text-card-foreground text-start"
                    style={{ writingDirection: 'ltr', textAlign: isRTL ? 'right' : 'left' }}
                  >
                    {row.title}
                  </Text>
                  <StatusBadge label={row.status} tone={row.tone ?? 'neutral'} />
                </View>
                {row.subtitle ? (
                  <Text className="mt-1 text-sm text-muted-foreground text-start">{row.subtitle}</Text>
                ) : null}
                <View className="mt-2 flex-row items-center justify-between">
                  <Text className="text-xs text-muted-foreground text-start">
                    {row.dateLabel ? `${row.dateLabel}: ` : ''}
                    {row.dateOnly ? formatDate(row.date, locale) : formatDateTime(row.date, locale)}
                  </Text>
                  {row.trailing ? (
                    <Text
                      className="text-sm font-medium text-card-foreground"
                      style={{ writingDirection: 'ltr' }}
                    >
                      {row.trailing}
                    </Text>
                  ) : null}
                </View>
              </Card>
            );
            return onPress ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onPress(item);
                }}
                className="active:opacity-80"
              >
                {body}
              </Pressable>
            ) : (
              body
            );
          }}
        />
      )}
    </Screen>
  );
}
