import type { CalendarEntryDto, VehicleAssignmentDto, VehicleDto, VehiclePublicDto } from '@unigate/types';
import { toMoneyString } from '@/common/money.js';
import type { Dispatchability } from './vehicle.policy.js';
import type { AssignmentRow, CalendarRow, VehicleRow } from './vehicle.repository.js';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);
const dec = (d: { toString(): string } | null): string | null => (d ? toMoneyString(d.toString()) : null);

/** Full record for the owner and staff. VIN is masked for anyone else who reaches this DTO. */
export function toVehicleDto(v: VehicleRow, dispatchable: Dispatchability, revealVin: boolean): VehicleDto {
  return {
    id: v.id,
    ownerProfileId: v.ownerProfileId,
    category: { id: v.category.id, code: v.category.code, nameEn: v.category.nameEn, nameAr: v.category.nameAr, transportType: v.category.transportType },
    make: v.make ? { id: v.make.id, name: v.make.name } : null,
    model: v.model ? { id: v.model.id, name: v.model.name } : null,
    modelYear: v.modelYear,
    plateNumberEn: v.plateNumberEn,
    plateNumberAr: v.plateNumberAr,
    sequenceNumber: v.sequenceNumber,
    registrationNumber: v.registrationNumber,
    vin: v.vin ? (revealVin ? v.vin : `•••••••••••••${v.vin.slice(-4)}`) : null,
    colorCode: v.colorCode,
    passengerCapacity: v.passengerCapacity,
    payloadCapacityKg: dec(v.payloadCapacityKg),
    cargoVolumeM3: dec(v.cargoVolumeM3),
    cargoLengthCm: v.cargoLengthCm,
    cargoWidthCm: v.cargoWidthCm,
    cargoHeightCm: v.cargoHeightCm,
    bodyType: v.bodyType,
    hasRefrigeration: v.hasRefrigeration,
    hasTailLift: v.hasTailLift,
    approvalStatus: v.approvalStatus,
    lifecycleStatus: v.lifecycleStatus,
    operationalStatus: v.operationalStatus,
    approvedAt: iso(v.approvedAt),
    rejectionReason: v.rejectionReason,
    insurancePolicyNumber: v.insurancePolicyNumber,
    insuranceExpiryDate: isoDate(v.insuranceExpiryDate),
    registrationExpiryDate: isoDate(v.registrationExpiryDate),
    inspectionExpiryDate: isoDate(v.inspectionExpiryDate),
    odometerKm: v.odometerKm,
    baseCityId: v.baseCityId,
    notes: v.notes,
    ratingAvg: v.ratingAvg.toFixed(2),
    ratingCount: v.ratingCount,
    currentDrivers: v.driverAssignments.map((a) => ({ assignmentId: a.id, driverProfileId: a.driverProfileId, driverName: a.driverProfile.user.fullNameEn, isPrimary: a.isPrimary, assignedFrom: a.assignedFrom.toISOString() })),
    dispatchable,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

/** What a counterparty sees: make/model/category/plate/rating — never owner identity or documents. */
export function toVehiclePublicDto(v: VehicleRow): VehiclePublicDto {
  return {
    id: v.id,
    category: { id: v.category.id, code: v.category.code, nameEn: v.category.nameEn, nameAr: v.category.nameAr, transportType: v.category.transportType },
    make: v.make?.name ?? null,
    model: v.model?.name ?? null,
    modelYear: v.modelYear,
    plateNumberEn: v.plateNumberEn,
    colorCode: v.colorCode,
    passengerCapacity: v.passengerCapacity,
    payloadCapacityKg: dec(v.payloadCapacityKg),
    hasRefrigeration: v.hasRefrigeration,
    hasTailLift: v.hasTailLift,
    ratingAvg: v.ratingAvg.toFixed(2),
    ratingCount: v.ratingCount,
  };
}

export function toCalendarEntryDto(e: CalendarRow): CalendarEntryDto {
  return {
    id: e.id,
    entryType: e.entry_type,
    status: e.status,
    period: { from: e.period_from.toISOString(), to: e.period_to.toISOString() },
    bookingId: e.booking_id,
    bookingNumber: e.booking_number,
    maintenanceRecordId: e.maintenance_record_id,
    notes: e.notes,
    createdAt: e.created_at.toISOString(),
  };
}

export function toAssignmentDto(a: AssignmentRow): VehicleAssignmentDto {
  return {
    id: a.id, vehicleId: a.vehicleId, driverProfileId: a.driverProfileId, driverName: a.driverProfile.user.fullNameEn, isPrimary: a.isPrimary,
    assignedFrom: a.assignedFrom.toISOString(), assignedTo: iso(a.assignedTo), unassignedReason: a.unassignedReason, assignedByUserId: a.assignedByUserId,
  };
}
