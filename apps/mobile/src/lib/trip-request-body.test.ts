import { describe, expect, it } from 'vitest';
import type { CityDto, SavedLocationDto } from '@unigate/types';
import {
  buildTripRequestBody,
  DEFAULT_FORM,
  DEFAULT_GOODS,
  DEFAULT_PASSENGER,
  decimal2,
  goodsDetailsBody,
  validateRequestForm,
} from './trip-request-body';

const riyadh: CityDto = { id: 'c-ryd', regionId: 'r', code: 'RUH', nameEn: 'Riyadh', nameAr: 'الرياض', latitude: 24.7136, longitude: 46.6753, isActive: true };
const jeddah: CityDto = { id: 'c-jed', regionId: 'r', code: 'JED', nameEn: 'Jeddah', nameAr: 'جدة', latitude: 21.4858, longitude: 39.1925, isActive: true };
const home: SavedLocationDto = { id: 's-home', label: 'Home', addressLine: '12 Olaya St', cityId: 'c-ryd', latitude: 24.69, longitude: 46.68, placeId: null, createdAt: '', updatedAt: '' };
const ctx = { cities: [riyadh, jeddah], saved: [home] };

const pickupAt = new Date('2026-10-01T08:00:00.000Z');

describe('buildTripRequestBody — passenger', () => {
  it('sends the passenger block only, numbers as integers, and city-centre coordinates when no saved location is chosen', () => {
    const body = buildTripRequestBody(
      { ...DEFAULT_FORM, vehicleCategoryId: 'cat', pickupAddress: 'Airport', pickupCityId: 'c-ryd', dropoffAddress: 'Hotel', dropoffCityId: 'c-jed', pickupAt },
      { ...DEFAULT_PASSENGER, passengerCount: '12', luggageCount: '3', childSeats: '1', wheelchair: true },
      DEFAULT_GOODS,
      ctx,
      true,
    );
    expect(body).toEqual({
      transportType: 'PASSENGER',
      vehicleCategoryId: 'cat',
      vehiclesRequired: 1,
      tripDirection: 'ONE_WAY',
      pickup: { addressLine: 'Airport', cityId: 'c-ryd', latitude: 24.7136, longitude: 46.6753 },
      dropoff: { addressLine: 'Hotel', cityId: 'c-jed', latitude: 21.4858, longitude: 39.1925 },
      pickupAt: '2026-10-01T08:00:00.000Z',
      passengerDetails: { passengerCount: 12, luggageCount: 3, tripPurpose: 'AIRPORT_TRANSFER', requiresWheelchairAccess: true, requiresFemaleDriver: false, childSeatsRequired: 1 },
      publish: true,
    });
    expect(body).not.toHaveProperty('goodsDetails');
    expect(body).not.toHaveProperty('allowPartialFulfilment');
    expect(body).not.toHaveProperty('budgetAmount');
    expect(body).not.toHaveProperty('returnAt');
  });

  it('uses the saved location coordinates, sends partial fulfilment for multi-vehicle, budget as 2dp and the return time on a round trip', () => {
    const returnAt = new Date('2026-10-02T08:00:00.000Z');
    const body = buildTripRequestBody(
      { ...DEFAULT_FORM, vehicleCategoryId: 'cat', vehiclesRequired: '3', allowPartialFulfilment: true, tripDirection: 'ROUND_TRIP', pickupAddress: home.addressLine, pickupCityId: home.cityId, pickupSavedId: home.id, dropoffAddress: 'Hotel', dropoffCityId: 'c-jed', pickupAt, returnAt, budget: '1500', instructions: '  call on arrival  ' },
      DEFAULT_PASSENGER,
      DEFAULT_GOODS,
      ctx,
      false,
    );
    expect(body['pickup']).toEqual({ addressLine: '12 Olaya St', cityId: 'c-ryd', latitude: 24.69, longitude: 46.68 });
    expect(body['vehiclesRequired']).toBe(3);
    expect(body['allowPartialFulfilment']).toBe(true);
    expect(body['returnAt']).toBe('2026-10-02T08:00:00.000Z');
    expect(body['budgetAmount']).toBe('1500.00');
    expect(body['specialInstructions']).toBe('call on arrival');
    expect(body['publish']).toBe(false);
  });
});

describe('goodsDetailsBody', () => {
  it('encodes weight/volume/value as 2dp strings, omits blanks, and adds temperatures only with refrigeration', () => {
    expect(goodsDetailsBody({ ...DEFAULT_GOODS, cargoDescription: 'Pallets', cargoWeightKg: '1200' })).toEqual({
      cargoType: 'GENERAL',
      cargoDescription: 'Pallets',
      cargoWeightKg: '1200.00',
      requiresRefrigeration: false,
      requiresTailLift: false,
      requiresCrane: false,
      loadingResponsibility: 'CUSTOMER',
      unloadingResponsibility: 'CUSTOMER',
      requiresInsurance: false,
    });
    const chilled = goodsDetailsBody({ ...DEFAULT_GOODS, cargoType: 'PERISHABLE', cargoDescription: 'Dates', cargoWeightKg: '500.5', cargoVolumeM3: '2', packageCount: '40', requiresRefrigeration: true, tempMin: '-2', tempMax: '4', declaredValue: '9999.999', shipperName: 'A', shipperPhone: '+966500000001', consigneeName: 'B', consigneePhone: '+966500000002', loadingInstructions: 'dock 3', requiresInsurance: true, requiresTailLift: true });
    expect(chilled).toMatchObject({ cargoWeightKg: '500.50', cargoVolumeM3: '2.00', packageCount: 40, requiredTemperatureMinC: -2, requiredTemperatureMaxC: 4, declaredValueAmount: '10000.00', shipperContactName: 'A', shipperContactPhone: '+966500000001', consigneeContactName: 'B', consigneeContactPhone: '+966500000002', loadingInstructions: 'dock 3', requiresInsurance: true, requiresTailLift: true });
  });

  it('is the block sent for GOODS requests, with no passenger block', () => {
    const body = buildTripRequestBody(
      { ...DEFAULT_FORM, transportType: 'GOODS', vehicleCategoryId: 'cat', pickupAddress: 'Warehouse', pickupCityId: 'c-ryd', dropoffAddress: 'Port', dropoffCityId: 'c-jed', pickupAt },
      DEFAULT_PASSENGER,
      { ...DEFAULT_GOODS, cargoDescription: 'Pallets', cargoWeightKg: '1200' },
      ctx,
      true,
    );
    expect(body['transportType']).toBe('GOODS');
    expect(body).toHaveProperty('goodsDetails');
    expect(body).not.toHaveProperty('passengerDetails');
  });
});

describe('decimal2 / validateRequestForm', () => {
  it('formats like the web form', () => {
    expect(decimal2('12')).toBe('12.00');
    expect(decimal2('12.5')).toBe('12.50');
    expect(decimal2('')).toBe('0.00');
  });

  it('flags the fields the web disables the buttons on, plus the date checks', () => {
    const errors = validateRequestForm({ ...DEFAULT_FORM, tripDirection: 'ROUND_TRIP' }, DEFAULT_GOODS);
    expect(Object.keys(errors).sort()).toEqual(['dropoff.addressLine', 'dropoff.cityId', 'pickup.addressLine', 'pickup.cityId', 'pickupAt', 'returnAt', 'vehicleCategoryId']);
    const ok = validateRequestForm({ ...DEFAULT_FORM, vehicleCategoryId: 'c', pickupAddress: 'abc', pickupCityId: 'x', dropoffAddress: 'def', dropoffCityId: 'y', pickupAt }, DEFAULT_GOODS);
    expect(ok).toEqual({});
    const back = validateRequestForm({ ...DEFAULT_FORM, vehicleCategoryId: 'c', pickupAddress: 'abc', pickupCityId: 'x', dropoffAddress: 'def', dropoffCityId: 'y', pickupAt, tripDirection: 'ROUND_TRIP', returnAt: pickupAt }, DEFAULT_GOODS);
    expect(back).toEqual({ returnAt: 'requests.form.returnAfterPickup' });
    const goods = validateRequestForm({ ...DEFAULT_FORM, transportType: 'GOODS', vehicleCategoryId: 'c', pickupAddress: 'abc', pickupCityId: 'x', dropoffAddress: 'def', dropoffCityId: 'y', pickupAt }, DEFAULT_GOODS);
    expect(Object.keys(goods).sort()).toEqual(['goodsDetails.cargoDescription', 'goodsDetails.cargoWeightKg']);
  });
});
