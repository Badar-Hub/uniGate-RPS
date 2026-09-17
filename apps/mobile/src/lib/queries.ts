import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  BookingDto,
  CityDto,
  CustomerCreditDto,
  InvoiceDto,
  NotificationUnreadCountDto,
  PaymentConfigDto,
  SavedLocationDto,
  TripRequestDto,
  VehicleCategoryDto,
} from '@unigate/types';
import { fetchOrThrow } from '@/lib/api';

/**
 * Query keys and the read hooks shared by more than one screen. Keys are hierarchical so a
 * mutation can invalidate a whole family (`['bookings']`) or one row (`['bookings', id]`).
 */
export const keys = {
  settingsPublic: ['settings', 'public'] as const,
  cities: ['reference', 'cities'] as const,
  categories: (transportType: string) => ['reference', 'vehicle-categories', transportType] as const,
  savedLocations: ['me', 'saved-locations'] as const,
  requests: ['trip-requests'] as const,
  request: (id: string) => ['trip-requests', id] as const,
  requestBids: (id: string) => ['trip-requests', id, 'bids'] as const,
  bookings: ['bookings'] as const,
  booking: (id: string) => ['bookings', id] as const,
  bookingHistory: (id: string) => ['bookings', id, 'status-history'] as const,
  cancellationQuote: (id: string) => ['bookings', id, 'cancellation-quote'] as const,
  paymentConfig: ['payments', 'config'] as const,
  tracking: (tripId: string) => ['tracking', tripId] as const,
  trackingHistory: (tripId: string) => ['tracking', tripId, 'history'] as const,
  ratingsEligible: ['ratings', 'eligible'] as const,
  complaints: ['complaints'] as const,
  complaint: (id: string) => ['complaints', id] as const,
  notifications: ['notifications'] as const,
  unreadCount: ['notifications', 'unread-count'] as const,
  credit: (customerId: string) => ['customers', customerId, 'credit'] as const,
  statement: (customerId: string, from: string, to: string) =>
    ['customers', customerId, 'statement', from, to] as const,
  invoices: ['invoices'] as const,
  invoice: (id: string) => ['invoices', id] as const,
  invoiceLines: (id: string) => ['invoices', id, 'lines'] as const,
} satisfies Record<string, QueryKey | ((...args: never[]) => QueryKey)>;

export interface PublicSetting {
  key: string;
  value: unknown;
}

/** `GET /settings/public` — the verticals a deployment accepts (`platform.verticals_enabled`), complaint categories, … */
export function usePublicSettings() {
  return useQuery({
    queryKey: keys.settingsPublic,
    queryFn: () => fetchOrThrow<PublicSetting[]>('/settings/public'),
    staleTime: 10 * 60 * 1000,
  });
}

export function settingValue(settings: PublicSetting[] | undefined, key: string): unknown {
  return settings?.find((s) => s.key === key)?.value;
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

export function useCities() {
  return useQuery({
    queryKey: keys.cities,
    queryFn: () => fetchOrThrow<CityDto[]>('/reference/cities'),
    staleTime: 60 * 60 * 1000,
  });
}

export function useVehicleCategories(transportType: string) {
  return useQuery({
    queryKey: keys.categories(transportType),
    queryFn: () =>
      fetchOrThrow<VehicleCategoryDto[]>('/vehicle-categories', { query: { transportType } }),
    staleTime: 60 * 60 * 1000,
  });
}

export function useSavedLocations(enabled = true) {
  return useQuery({
    queryKey: keys.savedLocations,
    queryFn: () => fetchOrThrow<SavedLocationDto[]>('/me/saved-locations'),
    enabled,
  });
}

export function useTripRequest(id: string) {
  return useQuery({
    queryKey: keys.request(id),
    queryFn: () => fetchOrThrow<TripRequestDto>(`/trip-requests/${id}`),
    enabled: id.length > 0,
  });
}

export function useBooking(id: string) {
  return useQuery({
    queryKey: keys.booking(id),
    queryFn: () => fetchOrThrow<BookingDto>(`/bookings/${id}`),
    enabled: id.length > 0,
  });
}

export function usePaymentConfig(enabled = true) {
  return useQuery({
    queryKey: keys.paymentConfig,
    queryFn: () => fetchOrThrow<PaymentConfigDto>('/payments/config'),
    staleTime: 10 * 60 * 1000,
    enabled,
  });
}

export function useCustomerCredit(customerId: string | null) {
  return useQuery({
    queryKey: keys.credit(customerId ?? ''),
    queryFn: () => fetchOrThrow<CustomerCreditDto>(`/customers/${customerId ?? ''}/credit`),
    enabled: Boolean(customerId),
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: keys.invoice(id),
    queryFn: () => fetchOrThrow<InvoiceDto>(`/invoices/${id}`),
    enabled: id.length > 0,
  });
}

export function useUnreadCountQuery(enabled: boolean) {
  return useQuery({
    queryKey: keys.unreadCount,
    queryFn: () => fetchOrThrow<NotificationUnreadCountDto>('/notifications/unread-count'),
    enabled,
    staleTime: 30 * 1000,
  });
}

/** Invalidate the families a mutation touches; one place so screens do not each list the keys. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...families: QueryKey[]) => Promise.all(families.map((k) => qc.invalidateQueries({ queryKey: k })));
}
