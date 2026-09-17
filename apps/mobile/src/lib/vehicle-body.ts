/**
 * Builds the `POST /vehicles` body (api.md §8.8, `createVehicleBody` in @unigate/validation)
 * from the registration form, the way the web portal's `vehicle-form.tsx` does: integers for
 * year / capacity / odometer, numbers for payload and volume, trimmed strings, the plate upper-
 * cased, empty optionals omitted (the schema is `.strict()`), and the capacity field that
 * matches the category's vertical. Pure, unit-tested.
 */

export type TransportType = 'PASSENGER' | 'GOODS';

export interface VehicleFormState {
  vehicleCategoryId: string;
  vehicleMakeId: string;
  vehicleModelId: string;
  modelYear: string;
  plateNumberEn: string;
  plateNumberAr: string;
  sequenceNumber: string;
  registrationNumber: string;
  vin: string;
  colorCode: string;
  passengerCapacity: string;
  payloadCapacityKg: string;
  cargoVolumeM3: string;
  bodyType: string;
  hasRefrigeration: boolean;
  hasTailLift: boolean;
  baseCityId: string;
  odometerKm: string;
  insuranceExpiryDate: string;
  registrationExpiryDate: string;
  inspectionExpiryDate: string;
  notes: string;
}

export const DEFAULT_VEHICLE_FORM: VehicleFormState = {
  vehicleCategoryId: '',
  vehicleMakeId: '',
  vehicleModelId: '',
  modelYear: String(new Date().getFullYear()),
  plateNumberEn: '',
  plateNumberAr: '',
  sequenceNumber: '',
  registrationNumber: '',
  vin: '',
  colorCode: '',
  passengerCapacity: '',
  payloadCapacityKg: '',
  cargoVolumeM3: '',
  bodyType: '',
  hasRefrigeration: false,
  hasTailLift: false,
  baseCityId: '',
  odometerKm: '',
  insuranceExpiryDate: '',
  registrationExpiryDate: '',
  inspectionExpiryDate: '',
  notes: '',
};

export const KNOWN_VEHICLE_FIELDS = [...Object.keys(DEFAULT_VEHICLE_FORM), 'ownerProfileId'];

export const PLATE_EN = /^\d{1,4}\s?[A-Z]{3}$/;
export const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Client-side gate mirroring the schema's hard rules; the API re-validates everything. */
export function validateVehicleForm(form: VehicleFormState, transportType: TransportType | null): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.vehicleCategoryId) errors['vehicleCategoryId'] = 'fleet.form.errors.required';
  const year = Number(form.modelYear);
  const maxYear = new Date().getUTCFullYear() + 2;
  if (!Number.isInteger(year) || year < 1980 || year > maxYear) errors['modelYear'] = 'fleet.form.errors.year';
  if (!PLATE_EN.test(form.plateNumberEn.trim().toUpperCase())) errors['plateNumberEn'] = 'fleet.form.errors.plate';
  if (form.plateNumberAr.trim() && (form.plateNumberAr.trim().length < 3 || form.plateNumberAr.trim().length > 24)) errors['plateNumberAr'] = 'fleet.form.errors.plateAr';
  if (form.registrationNumber.trim().length < 3) errors['registrationNumber'] = 'fleet.form.errors.registration';
  if (form.vin.trim() && !VIN.test(form.vin.trim().toUpperCase())) errors['vin'] = 'fleet.form.errors.vin';
  if (form.colorCode.trim().length < 2) errors['colorCode'] = 'fleet.form.errors.colour';
  if (transportType === 'GOODS') {
    const kg = Number(form.payloadCapacityKg);
    if (!form.payloadCapacityKg.trim() || !(kg > 0) || kg > 100_000) errors['payloadCapacityKg'] = 'fleet.form.errors.payload';
    if (form.cargoVolumeM3.trim()) {
      const m3 = Number(form.cargoVolumeM3);
      if (!(m3 > 0) || m3 > 1000) errors['cargoVolumeM3'] = 'fleet.form.errors.volume';
    }
  } else if (transportType === 'PASSENGER') {
    const seats = Number(form.passengerCapacity);
    if (!form.passengerCapacity.trim() || !Number.isInteger(seats) || seats < 1 || seats > 100) errors['passengerCapacity'] = 'fleet.form.errors.seats';
  }
  if (form.odometerKm.trim()) {
    const km = Number(form.odometerKm);
    if (!Number.isInteger(km) || km < 0 || km > 5_000_000) errors['odometerKm'] = 'fleet.form.errors.odometer';
  }
  for (const k of ['insuranceExpiryDate', 'registrationExpiryDate', 'inspectionExpiryDate'] as const) {
    if (form[k] && !ISO_DAY.test(form[k])) errors[k] = 'fleet.form.errors.date';
  }
  return errors;
}

export interface CreateVehicleBody {
  vehicleCategoryId: string;
  vehicleMakeId?: string;
  vehicleModelId?: string;
  modelYear: number;
  plateNumberEn: string;
  plateNumberAr?: string;
  sequenceNumber?: string;
  registrationNumber: string;
  vin?: string;
  colorCode: string;
  passengerCapacity?: number;
  payloadCapacityKg?: number;
  cargoVolumeM3?: number;
  bodyType?: string;
  hasRefrigeration?: boolean;
  hasTailLift?: boolean;
  baseCityId?: string;
  odometerKm?: number;
  insuranceExpiryDate?: string;
  registrationExpiryDate?: string;
  inspectionExpiryDate?: string;
  notes?: string;
}

export function buildVehicleBody(form: VehicleFormState, transportType: TransportType | null): CreateVehicleBody {
  const str = (v: string) => v.trim();
  return {
    vehicleCategoryId: form.vehicleCategoryId,
    ...(form.vehicleMakeId ? { vehicleMakeId: form.vehicleMakeId } : {}),
    ...(form.vehicleModelId ? { vehicleModelId: form.vehicleModelId } : {}),
    modelYear: Number(form.modelYear),
    plateNumberEn: str(form.plateNumberEn).toUpperCase(),
    ...(str(form.plateNumberAr) ? { plateNumberAr: str(form.plateNumberAr) } : {}),
    ...(str(form.sequenceNumber) ? { sequenceNumber: str(form.sequenceNumber) } : {}),
    registrationNumber: str(form.registrationNumber),
    ...(str(form.vin) ? { vin: str(form.vin).toUpperCase() } : {}),
    colorCode: str(form.colorCode),
    // The capacity block follows the category's vertical, like the web form's conditional field.
    ...(transportType === 'GOODS'
      ? {
          ...(form.payloadCapacityKg.trim() ? { payloadCapacityKg: Number(form.payloadCapacityKg) } : {}),
          ...(form.cargoVolumeM3.trim() ? { cargoVolumeM3: Number(form.cargoVolumeM3) } : {}),
          ...(str(form.bodyType) ? { bodyType: str(form.bodyType) } : {}),
          hasRefrigeration: form.hasRefrigeration,
          hasTailLift: form.hasTailLift,
        }
      : { ...(form.passengerCapacity.trim() ? { passengerCapacity: Number(form.passengerCapacity) } : {}) }),
    ...(form.baseCityId ? { baseCityId: form.baseCityId } : {}),
    ...(form.odometerKm.trim() ? { odometerKm: Number(form.odometerKm) } : {}),
    ...(form.insuranceExpiryDate ? { insuranceExpiryDate: form.insuranceExpiryDate } : {}),
    ...(form.registrationExpiryDate ? { registrationExpiryDate: form.registrationExpiryDate } : {}),
    ...(form.inspectionExpiryDate ? { inspectionExpiryDate: form.inspectionExpiryDate } : {}),
    ...(str(form.notes) ? { notes: str(form.notes) } : {}),
  };
}
