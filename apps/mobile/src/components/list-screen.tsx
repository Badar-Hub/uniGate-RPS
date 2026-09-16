import { FlatList, RefreshControl, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import type { Query } from '@unigate/api-client';
import { useI18n } from '@/i18n';
import { apiErrorOf, fetchOrThrow } from '@/lib/api';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorBanner,
  Loading,
  Screen,
  Title,
  usePalette,
} from '@/components/ui';

export interface Row {
  id: string;
  /** e.g. the request / booking number. */
  title: string;
  subtitle?: string | undefined;
  status: string;
  /** ISO date shown formatted in the active locale. */
  date: string | null;
  dateLabel?: string | undefined;
}

interface Props<T> {
  title: string;
  queryKey: readonly unknown[];
  path: string;
  query?: Query;
  toRow: (item: T) => Row;
}

/**
 * The M0 placeholder list: one paginated GET (first page, api.md §5) rendered as
 * number + status + date. Detail screens and infinite scroll are M1.
 */
export function ListScreen<T>({ title, queryKey, path, query, toRow }: Props<T>) {
  const { t, errorMessage, locale } = useI18n();
  const colors = usePalette();
  const q = useQuery({ queryKey, queryFn: () => fetchOrThrow<T[]>(path, query ? { query } : {}) });

  const fmt = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-GB', {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '—';

  return (
    <Screen>
      <View className="py-3">
        <Title>{title}</Title>
      </View>
      {q.isPending ? (
        <Loading />
      ) : q.isError ? (
        <View>
          <ErrorBanner message={errorMessage(apiErrorOf(q.error))} />
          <Button title={t('common.retry')} variant="secondary" onPress={() => void q.refetch()} />
        </View>
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(item) => toRow(item).id}
          refreshControl={
            <RefreshControl
              refreshing={q.isRefetching}
              onRefresh={() => void q.refetch()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={<Empty text={t('common.empty')} />}
          contentContainerClassName="pb-6"
          renderItem={({ item }) => {
            const row = toRow(item);
            return (
              <Card>
                <View className="flex-row items-center justify-between">
                  <Text className="text-base font-semibold text-card-foreground text-start">
                    {row.title}
                  </Text>
                  <Badge>{row.status}</Badge>
                </View>
                {row.subtitle ? (
                  <Text className="mt-1 text-sm text-muted-foreground text-start">
                    {row.subtitle}
                  </Text>
                ) : null}
                <Text className="mt-2 text-xs text-muted-foreground text-start">
                  {row.dateLabel ? `${row.dateLabel}: ` : ''}
                  {fmt(row.date)}
                </Text>
              </Card>
            );
          }}
        />
      )}
    </Screen>
  );
}
