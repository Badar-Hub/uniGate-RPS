import { describe, expect, it } from 'vitest';
import { buildVehicleBody, DEFAULT_VEHICLE_FORM, validateVehicleForm, type VehicleFormState } from './vehicle-body';

const filled: VehicleFormState = {
  ...DEFAULT_VEHICLE_FORM,
  vehicleCategoryId: 'cat',
  modelYear: '2022',
  plateNumberEn: ' 1234 abc ',
  registrationNumber: 'REG-99',
  colorCode: 'White',
  passengerCapacity: '12',
};

describe('buildVehicleBody', () => {
  it('sends the required fields only, upper-cases the plate and omits blanks (strict schema)', () => {
    expect(buildVehicleBody(filled, 'PASSENGER')).toEqual({
      vehicleCategoryId: 'cat',
      modelYear: 2022,
      plateNumberEn: '1234 ABC',
      registrationNumber: 'REG-99',
      colorCode: 'White',
      passengerCapacity: 12,
    });
  });

  it('carries the goods capacity block for a GOODS category and never the seat count', () => {
    const body = buildVehicleBody(
      { ...filled, passengerCapacity: '40', payloadCapacityKg: '3500', cargoVolumeM3: '18.5', bodyType: 'Box', hasRefrigeration: true, hasTailLift: false },
      'GOODS',
    );
    expect(body).toMatchObject({ payloadCapacityKg: 3500, cargoVolumeM3: 18.5, bodyType: 'Box', hasRefrigeration: true, hasTailLift: false });
    expect('passengerCapacity' in body).toBe(false);
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
      registrationNumber: 'fleet.form.errors.registration',
      vin: 'fleet.form.errors.vin',
      colorCode: 'fleet.form.errors.colour',
      passengerCapacity: 'fleet.form.errors.seats',
    });
  });

  it('requires the payload for goods and validates the optional volume, odometer and dates', () => {
    expect(validateVehicleForm({ ...filled, passengerCapacity: '' }, 'GOODS')).toEqual({ payloadCapacityKg: 'fleet.form.errors.payload' });
    expect(validateVehicleForm({ ...filled, payloadCapacityKg: '500', cargoVolumeM3: '0' }, 'GOODS')).toEqual({ cargoVolumeM3: 'fleet.form.errors.volume' });
    expect(validateVehicleForm({ ...filled, odometerKm: '1.5' }, 'PASSENGER')).toEqual({ odometerKm: 'fleet.form.errors.odometer' });
    expect(validateVehicleForm({ ...filled, insuranceExpiryDate: '31/01/2027' }, 'PASSENGER')).toEqual({ insuranceExpiryDate: 'fleet.form.errors.date' });
  });
});
