import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type {
  BidDto,
  BookingDto,
  CalendarEntryDto,
  CityDto,
  CodedLabelDto,
  CustomerCreditDto,
  DocumentRequirementDto,
  DriverDto,
  InvoiceDto,
  MaintenanceRecordDto,
  NotificationUnreadCountDto,
  OpportunityDto,
  OwnerDto,
  PaymentConfigDto,
  SavedLocationDto,
  SettlementDto,
  SettlementLineDto,
  TripRequestDto,
  VehicleAssignmentDto,
  VehicleCategoryDto,
  VehicleDto,
  VehicleMakeDto,
  VehicleModelDto,
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
  // ── vendor (M2) ──
  opportunities: ['opportunities'] as const,
  opportunity: (id: string) => ['opportunities', id] as const,
  bids: ['bids'] as const,
  bid: (id: string) => ['bids', id] as const,
  vehicles: ['vehicles'] as const,
  vehicle: (id: string) => ['vehicles', id] as const,
  vehicleCalendar: (id: string, from: string, to: string) => ['vehicles', id, 'calendar', from, to] as const,
  vehicleDrivers: (id: string) => ['vehicles', id, 'drivers'] as const,
  vehicleMakes: ['reference', 'vehicle-makes'] as const,
  vehicleModels: (makeId: string) => ['reference', 'vehicle-models', makeId] as const,
  allCategories: ['reference', 'vehicle-categories', 'all'] as const,
  drivers: ['drivers'] as const,
  driver: (id: string) => ['drivers', id] as const,
  documentRequirements: (kind: string, targetId: string, transportType: string | null) =>
    ['documents', 'requirements', kind, targetId, transportType ?? ''] as const,
  owner: (id: string) => ['owners', id] as const,
  settlements: ['settlements'] as const,
  settlement: (id: string) => ['settlements', id] as const,
  settlementLines: (id: string) => ['settlements', id, 'lines'] as const,
  expenses: ['expenses'] as const,
  expenseCategories: ['reference', 'expense-categories'] as const,
  maintenanceRecords: ['maintenance', 'records'] as const,
  maintenanceRecord: (id: string) => ['maintenance', 'records', id] as const,
  maintenanceTypes: ['reference', 'maintenance-service-types'] as const,
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

// ── vendor (M2) ─────────────────────────────────────────────────────────────

export function useOpportunity(id: string) {
  return useQuery({
    queryKey: keys.opportunity(id),
    queryFn: () => fetchOrThrow<OpportunityDto>(`/opportunities/${id}`),
    enabled: id.length > 0,
  });
}

export function useBid(id: string) {
  return useQuery({
    queryKey: keys.bid(id),
    queryFn: () => fetchOrThrow<BidDto>(`/bids/${id}`),
    enabled: id.length > 0,
  });
}

export function useVehicle(id: string) {
  return useQuery({
    queryKey: keys.vehicle(id),
    queryFn: () => fetchOrThrow<VehicleDto>(`/vehicles/${id}`),
    enabled: id.length > 0,
  });
}

/** The owner's whole fleet in one page (the pickers need every vehicle, not a page). */
export function useAllVehicles(enabled = true) {
  return useQuery({
    queryKey: [...keys.vehicles, 'all'] as const,
    queryFn: () => fetchOrThrow<VehicleDto[]>('/vehicles', { query: { page: 1, pageSize: 100 } }),
    enabled,
  });
}

/** Assignment history of a vehicle (open rows have `assignedTo === null`). */
export function useVehicleDrivers(vehicleId: string, enabled = true) {
  return useQuery({
    queryKey: keys.vehicleDrivers(vehicleId),
    queryFn: () => fetchOrThrow<VehicleAssignmentDto[]>(`/vehicles/${vehicleId}/drivers`),
    enabled: enabled && vehicleId.length > 0,
  });
}

export function useVehicleCalendar(vehicleId: string, from: string, to: string) {
  return useQuery({
    queryKey: keys.vehicleCalendar(vehicleId, from, to),
    queryFn: () => fetchOrThrow<CalendarEntryDto[]>(`/vehicles/${vehicleId}/calendar`, { query: { from, to } }),
    enabled: vehicleId.length > 0,
  });
}

export function useVehicleMakes() {
  return useQuery({
    queryKey: keys.vehicleMakes,
    queryFn: () => fetchOrThrow<VehicleMakeDto[]>('/reference/vehicle-makes'),
    staleTime: 60 * 60 * 1000,
  });
}

export function useVehicleModels(makeId: string) {
  return useQuery({
    queryKey: keys.vehicleModels(makeId),
    queryFn: () => fetchOrThrow<VehicleModelDto[]>('/reference/vehicle-models', { query: { makeId } }),
    enabled: makeId.length > 0,
    staleTime: 60 * 60 * 1000,
  });
}

/** Every category regardless of vertical (the vehicle form groups them by transport type). */
export function useAllVehicleCategories() {
  return useQuery({
    queryKey: keys.allCategories,
    queryFn: () => fetchOrThrow<VehicleCategoryDto[]>('/vehicle-categories'),
    staleTime: 60 * 60 * 1000,
  });
}

/** Drivers of the acting owner; `approvalStatus` narrows to one onboarding state. */
export function useDrivers(approvalStatus: string | null = null, enabled = true) {
  return useQuery({
    queryKey: [...keys.drivers, 'all', approvalStatus ?? ''] as const,
    queryFn: () => fetchOrThrow<DriverDto[]>('/drivers', { query: { page: 1, pageSize: 100, ...(approvalStatus ? { approvalStatus } : {}) } }),
    enabled,
  });
}

export function useDriver(id: string) {
  return useQuery({
    queryKey: keys.driver(id),
    queryFn: () => fetchOrThrow<DriverDto>(`/drivers/${id}`),
    enabled: id.length > 0,
  });
}

/** `GET /documents/requirements` — the checklist for one target (api.md §8.10). */
export function useDocumentRequirements(kind: string, targetId: string, transportType: string | null) {
  return useQuery({
    queryKey: keys.documentRequirements(kind, targetId, transportType),
    queryFn: () =>
      fetchOrThrow<DocumentRequirementDto[]>('/documents/requirements', {
        query: { appliesTo: kind, targetId, ...(transportType ? { transportType } : {}) },
      }),
    enabled: targetId.length > 0,
  });
}

export function useOwner(id: string | null) {
  return useQuery({
    queryKey: keys.owner(id ?? ''),
    queryFn: () => fetchOrThrow<OwnerDto>(`/owners/${id ?? ''}`),
    enabled: Boolean(id),
  });
}

export function useSettlement(id: string) {
  return useQuery({
    queryKey: keys.settlement(id),
    queryFn: () => fetchOrThrow<SettlementDto>(`/settlements/${id}`),
    enabled: id.length > 0,
  });
}

export function useSettlementLines(id: string) {
  return useQuery({
    queryKey: keys.settlementLines(id),
    queryFn: () => fetchOrThrow<SettlementLineDto[]>(`/settlements/${id}/lines`, { query: { page: 1, pageSize: 100 } }),
    enabled: id.length > 0,
  });
}

export function useExpenseCategories() {
  return useQuery({
    queryKey: keys.expenseCategories,
    queryFn: () => fetchOrThrow<CodedLabelDto[]>('/reference/expense-categories'),
    staleTime: 60 * 60 * 1000,
  });
}

export function useMaintenanceTypes() {
  return useQuery({
    queryKey: keys.maintenanceTypes,
    queryFn: () => fetchOrThrow<CodedLabelDto[]>('/reference/maintenance-service-types'),
    staleTime: 60 * 60 * 1000,
  });
}

export function useMaintenanceRecord(id: string) {
  return useQuery({
    queryKey: keys.maintenanceRecord(id),
    queryFn: () => fetchOrThrow<MaintenanceRecordDto>(`/maintenance/records/${id}`),
    enabled: id.length > 0,
  });
}

/** Invalidate the families a mutation touches; one place so screens do not each list the keys. */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...families: QueryKey[]) => Promise.all(families.map((k) => qc.invalidateQueries({ queryKey: k })));
}
