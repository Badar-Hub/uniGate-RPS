import type { MaintenanceDueDto, MaintenanceRecordDto, MaintenanceScheduleDto } from '@unigate/types';
import { toMoneyString } from '@/common/money.js';
import type { RecordRow, ScheduleRow } from './maintenance.repository.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function parts(raw: unknown): MaintenanceRecordDto['partsReplaced'] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    if (typeof p !== 'object' || p === null) return [];
    const o = p as { name?: unknown; quantity?: unknown; amount?: unknown };
    return [{ name: typeof o.name === 'string' ? o.name : '', quantity: typeof o.quantity === 'number' ? o.quantity : 1, amount: typeof o.amount === 'string' ? toMoneyString(o.amount) : null }];
  });
}

export function toRecordDto(r: RecordRow): MaintenanceRecordDto {
  return {
    id: r.id, vehicleId: r.vehicleId, vehiclePlate: r.vehicle.plateNumberEn, ownerProfileId: r.vehicle.ownerProfileId, serviceTypeId: r.maintenanceServiceTypeId, serviceTypeCode: r.serviceType.code, serviceTypeNameEn: r.serviceType.nameEn, serviceTypeNameAr: r.serviceType.nameAr,
    maintenanceKind: r.maintenanceKind, status: r.status, scheduledStartAt: r.scheduledStartAt.toISOString(), scheduledEndAt: r.scheduledEndAt.toISOString(), actualStartAt: iso(r.actualStartAt), actualEndAt: iso(r.actualEndAt), odometerKm: r.odometerKm,
    costAmount: toMoneyString(r.costAmount), vatAmount: toMoneyString(r.vatAmount), totalAmount: toMoneyString(r.totalAmount), currency: r.currency, workshopName: r.workshopName, workshopContact: r.workshopContact, description: r.description,
    partsReplaced: parts(r.partsReplaced), nextServiceDate: day(r.nextServiceDate), nextServiceOdometerKm: r.nextServiceOdometerKm, calendarEntryId: r.calendarEntry?.id ?? null, documentIds: r.documents.map((d) => d.id),
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

export function toScheduleDto(s: ScheduleRow): MaintenanceScheduleDto {
  return {
    id: s.id, vehicleId: s.vehicleId, vehiclePlate: s.vehicle.plateNumberEn, ownerProfileId: s.vehicle.ownerProfileId, serviceTypeId: s.maintenanceServiceTypeId, serviceTypeCode: s.serviceType.code, serviceTypeNameEn: s.serviceType.nameEn, serviceTypeNameAr: s.serviceType.nameAr,
    intervalKm: s.intervalKm, intervalDays: s.intervalDays, lastServiceAt: iso(s.lastServiceAt), lastServiceOdometerKm: s.lastServiceOdometerKm, nextDueAt: iso(s.nextDueAt), nextDueOdometerKm: s.nextDueOdometerKm, isActive: s.isActive,
    createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
  };
}

export function toDueDto(s: ScheduleRow, now: Date): MaintenanceDueDto {
  const daysUntilDue = s.nextDueAt ? Math.ceil((s.nextDueAt.getTime() - now.getTime()) / 86_400_000) : null;
  const kmUntilDue = s.nextDueOdometerKm !== null && s.vehicle.odometerKm !== null ? s.nextDueOdometerKm - s.vehicle.odometerKm : null;
  return {
    scheduleId: s.id, vehicleId: s.vehicleId, vehiclePlate: s.vehicle.plateNumberEn, ownerProfileId: s.vehicle.ownerProfileId, serviceTypeCode: s.serviceType.code, serviceTypeNameEn: s.serviceType.nameEn, serviceTypeNameAr: s.serviceType.nameAr,
    nextDueAt: iso(s.nextDueAt), nextDueOdometerKm: s.nextDueOdometerKm, currentOdometerKm: s.vehicle.odometerKm, daysUntilDue, kmUntilDue, overdue: (daysUntilDue !== null && daysUntilDue < 0) || (kmUntilDue !== null && kmUntilDue < 0),
  };
}
