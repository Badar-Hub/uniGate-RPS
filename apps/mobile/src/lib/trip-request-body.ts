import type { CityDto, SavedLocationDto } from '@unigate/types';

/**
 * Builds the `POST /trip-requests` body (api.md §8.11, `createTripRequestBody` in
 * @unigate/validation) from the form state, exactly the way the web portal's request form does:
 * numbers become 2dp decimal strings, empty optionals are omitted (the schema is `.strict()`),
 * coordinates come from the chosen saved location or else the city centre, and only the detail
 * block of the active vertical is sent. Pure, so the mapping is unit-tested.
 */

export type TransportType = 'PASSENGER' | 'GOODS';

export interface RequestFormState {
  transportType: TransportType;
  vehicleCategoryId: string;
  vehiclesRequired: string;
  /** Only sent when more than one vehicle is required. */
  allowPartialFulfilment: boolean;
  tripDirection: 'ONE_WAY' | 'ROUND_TRIP';
  pickupAddress: string;
  pickupCityId: string;
  /** Id of the saved location the address was taken from, if any (coordinates come from it). */
  pickupSavedId: string | null;
  dropoffAddress: string;
  dropoffCityId: string;
  dropoffSavedId: string | null;
  pickupAt: Date | null;
  returnAt: Date | null;
  budget: string;
  instructions: string;
}

export interface PassengerFormState {
  passengerCount: string;
  luggageCount: string;
  tripPurpose: string;
  wheelchair: boolean;
  femaleDriver: boolean;
  childSeats: string;
}

export interface GoodsFormState {
  cargoType: string;
  cargoDescription: string;
  cargoWeightKg: string;
  cargoVolumeM3: string;
  packageCount: string;
  requiresRefrigeration: boolean;
  tempMin: string;
  tempMax: string;
  requiresTailLift: boolean;
  requiresCrane: boolean;
  loadingResponsibility: string;
  unloadingResponsibility: string;
  loadingInstructions: string;
  declaredValue: string;
  requiresInsurance: boolean;
  shipperName: string;
  shipperPhone: string;
  consigneeName: string;
  consigneePhone: string;
}

export const DEFAULT_FORM: RequestFormState = {
  transportType: 'PASSENGER',
  vehicleCategoryId: '',
  vehiclesRequired: '1',
  allowPartialFulfilment: false,
  tripDirection: 'ONE_WAY',
  pickupAddress: '',
  pickupCityId: '',
  pickupSavedId: null,
  dropoffAddress: '',
  dropoffCityId: '',
  dropoffSavedId: null,
  pickupAt: null,
  returnAt: null,
  budget: '',
  instructions: '',
};

export const DEFAULT_PASSENGER: PassengerFormState = {
  passengerCount: '1',
  luggageCount: '0',
  tripPurpose: 'AIRPORT_TRANSFER',
  wheelchair: false,
  femaleDriver: false,
  childSeats: '0',
};

export const DEFAULT_GOODS: GoodsFormState = {
  cargoType: 'GENERAL',
  cargoDescription: '',
  cargoWeightKg: '',
  cargoVolumeM3: '',
  packageCount: '',
  requiresRefrigeration: false,
  tempMin: '2',
  tempMax: '8',
  requiresTailLift: false,
  requiresCrane: false,
  loadingResponsibility: 'CUSTOMER',
  unloadingResponsibility: 'CUSTOMER',
  loadingInstructions: '',
  declaredValue: '',
  requiresInsurance: false,
  shipperName: '',
  shipperPhone: '',
  consigneeName: '',
  consigneePhone: '',
};

/** `"12"` → `"12.00"`, `"12.5"` → `"12.50"`; the same `Number(x).toFixed(2)` the web sends. */
export function decimal2(value: string): string {
  return Number(value || 0).toFixed(2);
}

function int(value: string, fallback = 0): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface TripLocationBody {
  addressLine: string;
  cityId: string;
  latitude: number;
  longitude: number;
}

export function locationBody(
  address: string,
  cityId: string,
  savedId: string | null,
  ctx: { cities: readonly CityDto[]; saved: readonly SavedLocationDto[] },
): TripLocationBody {
  const s = savedId ? ctx.saved.find((x) => x.id === savedId) : undefined;
  const c = ctx.cities.find((x) => x.id === cityId);
  return {
    addressLine: address.trim(),
    cityId,
    latitude: s?.latitude ?? c?.latitude ?? 0,
    longitude: s?.longitude ?? c?.longitude ?? 0,
  };
}

export function passengerDetailsBody(p: PassengerFormState): Record<string, unknown> {
  return {
    passengerCount: int(p.passengerCount, 1),
    luggageCount: int(p.luggageCount),
    tripPurpose: p.tripPurpose,
    requiresWheelchairAccess: p.wheelchair,
    requiresFemaleDriver: p.femaleDriver,
    childSeatsRequired: int(p.childSeats),
  };
}

export function goodsDetailsBody(g: GoodsFormState): Record<string, unknown> {
  return {
    cargoType: g.cargoType,
    cargoDescription: g.cargoDescription.trim(),
    cargoWeightKg: decimal2(g.cargoWeightKg),
    ...(g.cargoVolumeM3 ? { cargoVolumeM3: decimal2(g.cargoVolumeM3) } : {}),
    ...(g.packageCount ? { packageCount: int(g.packageCount) } : {}),
    requiresRefrigeration: g.requiresRefrigeration,
    ...(g.requiresRefrigeration
      ? { requiredTemperatureMinC: Number(g.tempMin), requiredTemperatureMaxC: Number(g.tempMax) }
      : {}),
    requiresTailLift: g.requiresTailLift,
    requiresCrane: g.requiresCrane,
    loadingResponsibility: g.loadingResponsibility,
    unloadingResponsibility: g.unloadingResponsibility,
    ...(g.loadingInstructions.trim() ? { loadingInstructions: g.loadingInstructions.trim() } : {}),
    ...(g.declaredValue ? { declaredValueAmount: decimal2(g.declaredValue) } : {}),
    requiresInsurance: g.requiresInsurance,
    ...(g.shipperName.trim() ? { shipperContactName: g.shipperName.trim() } : {}),
    ...(g.shipperPhone.trim() ? { shipperContactPhone: g.shipperPhone.trim() } : {}),
    ...(g.consigneeName.trim() ? { consigneeContactName: g.consigneeName.trim() } : {}),
    ...(g.consigneePhone.trim() ? { consigneeContactPhone: g.consigneePhone.trim() } : {}),
  };
}

export function buildTripRequestBody(
  form: RequestFormState,
  passenger: PassengerFormState,
  goods: GoodsFormState,
  ctx: { cities: readonly CityDto[]; saved: readonly SavedLocationDto[] },
  publish: boolean,
): Record<string, unknown> {
  const vehiclesRequired = int(form.vehiclesRequired, 1);
  return {
    transportType: form.transportType,
    vehicleCategoryId: form.vehicleCategoryId,
    vehiclesRequired,
    ...(vehiclesRequired > 1 ? { allowPartialFulfilment: form.allowPartialFulfilment } : {}),
    tripDirection: form.tripDirection,
    pickup: locationBody(form.pickupAddress, form.pickupCityId, form.pickupSavedId, ctx),
    dropoff: locationBody(form.dropoffAddress, form.dropoffCityId, form.dropoffSavedId, ctx),
    pickupAt: (form.pickupAt ?? new Date(Number.NaN)).toISOString(),
    ...(form.tripDirection === 'ROUND_TRIP' && form.returnAt
      ? { returnAt: form.returnAt.toISOString() }
      : {}),
    ...(form.budget ? { budgetAmount: decimal2(form.budget) } : {}),
    ...(form.instructions.trim() ? { specialInstructions: form.instructions.trim() } : {}),
    ...(form.transportType === 'PASSENGER'
      ? { passengerDetails: passengerDetailsBody(passenger) }
      : { goodsDetails: goodsDetailsBody(goods) }),
    publish,
  };
}

/** Field names the form has inputs for; anything else from a 422 goes into the banner. */
export const KNOWN_REQUEST_FIELDS: readonly string[] = [
  'transportType',
  'vehicleCategoryId',
  'vehiclesRequired',
  'allowPartialFulfilment',
  'tripDirection',
  'pickup.addressLine',
  'pickup.cityId',
  'dropoff.addressLine',
  'dropoff.cityId',
  'pickupAt',
  'returnAt',
  'budgetAmount',
  'specialInstructions',
  'passengerDetails',
  'passengerDetails.passengerCount',
  'passengerDetails.luggageCount',
  'passengerDetails.childSeatsRequired',
  'goodsDetails',
  'goodsDetails.cargoType',
  'goodsDetails.cargoDescription',
  'goodsDetails.cargoWeightKg',
  'goodsDetails.cargoVolumeM3',
  'goodsDetails.packageCount',
  'goodsDetails.declaredValueAmount',
  'goodsDetails.shipperContactPhone',
  'goodsDetails.consigneeContactPhone',
];

/**
 * Client-side gate before the POST — the same conditions that disable the web buttons plus the
 * date check the web does in `submit`. Returns field → message key.
 */
export function validateRequestForm(form: RequestFormState, goods: GoodsFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.vehicleCategoryId) errors['vehicleCategoryId'] = 'requests.form.required';
  if (!form.pickupCityId) errors['pickup.cityId'] = 'requests.form.required';
  if (form.pickupAddress.trim().length < 3) errors['pickup.addressLine'] = 'requests.form.addressShort';
  if (!form.dropoffCityId) errors['dropoff.cityId'] = 'requests.form.required';
  if (form.dropoffAddress.trim().length < 3) errors['dropoff.addressLine'] = 'requests.form.addressShort';
  if (!form.pickupAt || Number.isNaN(form.pickupAt.getTime())) errors['pickupAt'] = 'requests.form.required';
  if (form.tripDirection === 'ROUND_TRIP') {
    if (!form.returnAt) errors['returnAt'] = 'requests.form.required';
    else if (form.pickupAt && form.returnAt.getTime() <= form.pickupAt.getTime())
      errors['returnAt'] = 'requests.form.returnAfterPickup';
  }
  if (form.transportType === 'GOODS') {
    if (goods.cargoDescription.trim().length < 3) errors['goodsDetails.cargoDescription'] = 'requests.form.required';
    if (!(Number(goods.cargoWeightKg) > 0)) errors['goodsDetails.cargoWeightKg'] = 'requests.form.required';
  }
  return errors;
}
