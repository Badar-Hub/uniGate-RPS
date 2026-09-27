import { describe, expect, it } from 'vitest';
import { buildVehicleBody, DEFAULT_VEHICLE_FORM, validateVehicleForm, type VehicleFormState } from './vehicle-body';

const filled: VehicleFormState = {
  ...DEFAULT_VEHICLE_FORM,
  vehicleCategoryId: 'cat',
  modelYear: '2022',
  plateNumberEn: ' 1234 abc ',
  ownerId: '1012345678',
  colorCode: 'White',
  passengerCapacity: '12',
};

describe('buildVehicleBody', () => {
  it('sends the required fields only, upper-cases the plate and omits blanks (strict schema)', () => {
    expect(buildVehicleBody(filled, 'PASSENGER')).toEqual({
      vehicleCategoryId: 'cat',
      modelYear: 2022,
      plateNumberEn: '1234 ABC',
      ownerId: '1012345678',
      colorCode: 'White',
      passengerCapacity: 12,
    });
  });

  it('sends no capacity for a goods category — only the optional length, in centimetres', () => {
    const body = buildVehicleBody({ ...filled, passengerCapacity: '40', vehicleLengthM: '6.2' }, 'GOODS');
    expect(body).toMatchObject({ vehicleLengthCm: 620 });
    expect('passengerCapacity' in body).toBe(false);
    expect('payloadCapacityKg' in body).toBe(false);
  });

  it('omits the length when it is left blank', () => {
    expect('vehicleLengthCm' in buildVehicleBody({ ...filled, passengerCapacity: '' }, 'GOODS')).toBe(false);
  });

  it('includes make/model/plateAr/sequence/vin/city/odometer/dates/notes when given', () => {
    const body = buildVehicleBody(
      {
        ...filled,
        vehicleMakeId: 'mk',
        vehicleModelId: 'md',
        plateNumberAr: 'أ ب ج ١٢٣٤',
        sequenceNumber: 'SEQ1',
        vin: 'jh4ka7561pc008269',
        baseCityId: 'city',
        odometerKm: '120000',
        insuranceExpiryDate: '2027-01-31',
        registrationExpiryDate: '2027-02-28',
        inspectionExpiryDate: '2026-12-31',
        notes: ' spare tyre ',
      },
      'PASSENGER',
    );
    expect(body).toMatchObject({
      vehicleMakeId: 'mk',
      vehicleModelId: 'md',
      plateNumberAr: 'أ ب ج ١٢٣٤',
      sequenceNumber: 'SEQ1',
      vin: 'JH4KA7561PC008269',
      baseCityId: 'city',
      odometerKm: 120000,
      insuranceExpiryDate: '2027-01-31',
      registrationExpiryDate: '2027-02-28',
      inspectionExpiryDate: '2026-12-31',
      notes: 'spare tyre',
    });
  });
});

describe('validateVehicleForm', () => {
  it('passes a complete passenger form', () => {
    expect(validateVehicleForm(filled, 'PASSENGER')).toEqual({});
  });

  it('flags the required fields and formats', () => {
    const errors = validateVehicleForm({ ...DEFAULT_VEHICLE_FORM, modelYear: '1970', plateNumberEn: 'ABC 12', vin: '123', colorCode: 'x' }, 'PASSENGER');
    expect(errors).toEqual({
      vehicleCategoryId: 'fleet.form.errors.required',
      modelYear: 'fleet.form.errors.year',
      plateNumberEn: 'fleet.form.errors.plate',
      ownerId: 'fleet.form.errors.ownerId',
      vin: 'fleet.form.errors.vin',
      colorCode: 'fleet.form.errors.colour',
      passengerCapacity: 'fleet.form.errors.seats',
    });
  });

  it('accepts a national ID (1…) or an iqama (2…) of ten digits and nothing else', () => {
    expect(validateVehicleForm({ ...filled, ownerId: '2012345678' }, 'PASSENGER')).toEqual({});
    for (const bad of ['3012345678', '101234567', '10123456789', '']) {
      expect(validateVehicleForm({ ...filled, ownerId: bad }, 'PASSENGER')).toEqual({ ownerId: 'fleet.form.errors.ownerId' });
    }
  });

  it('asks for no capacity on goods and checks the optional length, odometer and dates', () => {
    expect(validateVehicleForm({ ...filled, passengerCapacity: '' }, 'GOODS')).toEqual({});
    expect(validateVehicleForm({ ...filled, vehicleLengthM: '0' }, 'GOODS')).toEqual({ vehicleLengthCm: 'fleet.form.errors.length' });
    expect(validateVehicleForm({ ...filled, vehicleLengthM: '31' }, 'GOODS')).toEqual({ vehicleLengthCm: 'fleet.form.errors.length' });
    expect(validateVehicleForm({ ...filled, odometerKm: '1.5' }, 'PASSENGER')).toEqual({ odometerKm: 'fleet.form.errors.odometer' });
    expect(validateVehicleForm({ ...filled, insuranceExpiryDate: '31/01/2027' }, 'PASSENGER')).toEqual({ insuranceExpiryDate: 'fleet.form.errors.date' });
  });
});
