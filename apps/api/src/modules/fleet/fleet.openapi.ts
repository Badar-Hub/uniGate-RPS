/** OpenAPI registrations for /vehicles (api.md §8.8) and the reference catalogue (§8.9). */
import { z } from 'zod';
import {
  assignDriverBody,
  assignmentParams,
  calendarBlockBody,
  calendarEntryParams,
  calendarWindowQuery,
  createCategoryBody,
  createMakeBody,
  createModelBody,
  createVehicleBody,
  idParams,
  listCategoriesQuery,
  listCitiesQuery,
  listDocumentTypesQuery,
  listModelsQuery,
  listVehiclesQuery,
  patchCategoryBody,
  patchVehicleBody,
  unassignDriverBody,
  vehicleDecisionBody,
  vehicleRejectBody,
  vehicleSuspendBody,
} from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const errorRef = z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never);
const err = (description: string) => ({ description, content: { 'application/json': { schema: errorRef } } });
const ok = <T extends z.ZodTypeAny>(schema: T, name: string, description = 'OK') => ({ description, content: { 'application/json': { schema: successEnvelope(schema, name) } } });
const json = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });
const bearer = [{ bearerAuth: [] }];
const dec = z.string().regex(/^-?\d+\.\d{2}$/).nullable();

const categoryRef = z.object({ id: z.string().uuid(), code: z.string(), nameEn: z.string(), nameAr: z.string(), transportType: z.enum(['PASSENGER', 'GOODS']) });
const dispatchable = z.object({ ok: z.boolean(), reasons: z.array(z.string()) }).openapi('Dispatchability', { description: 'fleet/vehicle.policy — approved + active + owner approved + mandatory documents verified & unexpired' });
const vehicle = z
  .object({
    id: z.string().uuid(), ownerProfileId: z.string().uuid(), category: categoryRef, make: z.object({ id: z.string().uuid(), name: z.string() }).nullable(), model: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
    modelYear: z.number().int(), plateNumberEn: z.string(), plateNumberAr: z.string().nullable(), sequenceNumber: z.string().nullable(), registrationNumber: z.string(), vin: z.string().nullable().openapi({ description: 'masked to the last 4 for anyone but the owner and staff' }),
    colorCode: z.string(), passengerCapacity: z.number().int().nullable(), payloadCapacityKg: dec, cargoVolumeM3: dec, cargoLengthCm: z.number().int().nullable(), cargoWidthCm: z.number().int().nullable(), cargoHeightCm: z.number().int().nullable(),
    bodyType: z.string().nullable(), hasRefrigeration: z.boolean(), hasTailLift: z.boolean(), approvalStatus: z.string(), lifecycleStatus: z.string(), operationalStatus: z.string(), approvedAt: z.string().datetime().nullable(), rejectionReason: z.string().nullable(),
    insurancePolicyNumber: z.string().nullable(), insuranceExpiryDate: z.string().nullable(), registrationExpiryDate: z.string().nullable(), inspectionExpiryDate: z.string().nullable(), odometerKm: z.number().int().nullable(), baseCityId: z.string().uuid().nullable(), notes: z.string().nullable(),
    ratingAvg: z.string(), ratingCount: z.number().int(),
    currentDrivers: z.array(z.object({ assignmentId: z.string().uuid(), driverProfileId: z.string().uuid(), driverName: z.string(), isPrimary: z.boolean(), assignedFrom: z.string().datetime() })),
    dispatchable, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  })
  .openapi('Vehicle');
const calendarEntry = z
  .object({ id: z.string().uuid(), entryType: z.enum(['RESERVATION', 'MAINTENANCE', 'OWNER_BLOCK']), status: z.enum(['HELD', 'CONFIRMED', 'RELEASED']), period: z.object({ from: z.string().datetime(), to: z.string().datetime() }), bookingId: z.string().uuid().nullable(), bookingNumber: z.string().nullable(), maintenanceRecordId: z.string().uuid().nullable(), notes: z.string().nullable(), createdAt: z.string().datetime() })
  .openapi('CalendarEntry');
const availability = z
  .object({
    vehicleId: z.string().uuid(), window: z.object({ from: z.string().datetime(), to: z.string().datetime() }), available: z.boolean(), dispatchable,
    conflicts: z.array(z.object({ entryId: z.string().uuid(), entryType: z.string(), period: z.object({ from: z.string().datetime(), to: z.string().datetime() }) })),
    expiringDocuments: z.array(z.object({ documentTypeCode: z.string(), expiryDate: z.string() })),
  })
  .openapi('VehicleAvailability');
const assignment = z
  .object({ id: z.string().uuid(), vehicleId: z.string().uuid(), driverProfileId: z.string().uuid(), driverName: z.string(), isPrimary: z.boolean(), assignedFrom: z.string().datetime(), assignedTo: z.string().datetime().nullable(), unassignedReason: z.string().nullable(), assignedByUserId: z.string().uuid().nullable() })
  .openapi('VehicleAssignment');

registry.registerPath({ method: 'get', path: '/vehicles', tags: ['vehicles'], summary: 'Own fleet (owner) or all with vehicles.read_any', security: bearer, request: { query: listVehiclesQuery }, responses: { 200: ok(z.array(vehicle), 'VehicleListEnvelope', 'OK — paginated') } });
registry.registerPath({ method: 'post', path: '/vehicles', tags: ['vehicles'], summary: 'Register in DRAFT; capacity validated by the category’s vertical (vehicles.create)', security: bearer, request: { body: json(createVehicleBody) }, responses: { 201: ok(vehicle, 'VehicleEnvelope', 'Created'), 409: err('VEHICLE_PLATE_TAKEN / VEHICLE_VIN_TAKEN'), 422: err('VALIDATION_FAILED (capacity) / OWNER_NOT_APPROVED') } });
registry.registerPath({ method: 'get', path: '/vehicles/{id}', tags: ['vehicles'], summary: 'Full record (own → global)', security: bearer, request: { params: idParams }, responses: { 200: ok(vehicle, 'VehicleEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'patch', path: '/vehicles/{id}', tags: ['vehicles'], summary: 'Edit; plate/VIN/category changes after approval → PENDING_APPROVAL (vehicles.update)', security: bearer, request: { params: idParams, body: json(patchVehicleBody) }, responses: { 200: ok(vehicle, 'VehicleEnvelope'), 409: err('VEHICLE_PLATE_TAKEN / VEHICLE_VIN_TAKEN'), 422: err('VALIDATION_FAILED / VEHICLE_INVALID_TRANSITION') } });
registry.registerPath({ method: 'delete', path: '/vehicles/{id}', tags: ['vehicles'], summary: 'Soft delete → ARCHIVED; refused with future reservations (vehicles.delete)', security: bearer, request: { params: idParams }, responses: { 204: { description: 'Archived' }, 409: err('VEHICLE_HAS_ACTIVE_BOOKINGS') } });
registry.registerPath({ method: 'post', path: '/vehicles/{id}/submit-for-approval', tags: ['vehicles'], summary: 'DRAFT/REJECTED → PENDING_APPROVAL once mandatory documents are VERIFIED and unexpired', security: bearer, request: { params: idParams }, responses: { 200: ok(vehicle, 'VehicleEnvelope'), 422: err('OWNER_DOCUMENTS_INCOMPLETE (details.missing) / OWNER_NOT_APPROVED / VEHICLE_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/vehicles/{id}/approve', tags: ['vehicles'], summary: '→ APPROVED, lifecycle ACTIVE (vehicles.approve)', security: bearer, request: { params: idParams, body: json(vehicleDecisionBody) }, responses: { 200: ok(vehicle, 'VehicleEnvelope'), 422: err('VEHICLE_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/vehicles/{id}/reject', tags: ['vehicles'], summary: '→ REJECTED with a reason (vehicles.approve)', security: bearer, request: { params: idParams, body: json(vehicleRejectBody) }, responses: { 200: ok(vehicle, 'VehicleEnvelope'), 422: err('VEHICLE_INVALID_TRANSITION') } });
registry.registerPath({ method: 'post', path: '/vehicles/{id}/suspend', tags: ['vehicles'], summary: 'lifecycle → SUSPENDED; operational_status untouched (vehicles.suspend)', security: bearer, request: { params: idParams, body: json(vehicleSuspendBody) }, responses: { 200: ok(vehicle, 'VehicleEnvelope') } });
registry.registerPath({ method: 'post', path: '/vehicles/{id}/reactivate', tags: ['vehicles'], summary: 'SUSPENDED → ACTIVE (vehicles.suspend)', security: bearer, request: { params: idParams, body: json(vehicleDecisionBody) }, responses: { 200: ok(vehicle, 'VehicleEnvelope'), 422: err('VEHICLE_INVALID_TRANSITION') } });
registry.registerPath({ method: 'get', path: '/vehicles/{id}/calendar', tags: ['vehicles'], summary: 'Non-released calendar entries overlapping the window', security: bearer, request: { params: idParams, query: calendarWindowQuery }, responses: { 200: ok(z.array(calendarEntry), 'CalendarEntryListEnvelope') } });
registry.registerPath({ method: 'post', path: '/vehicles/{id}/calendar/blocks', tags: ['vehicles'], summary: 'Owner blackout [from, to); the EXCLUDE constraint refuses overlaps (vehicles.availability.manage)', security: bearer, request: { params: idParams, body: json(calendarBlockBody) }, responses: { 201: ok(calendarEntry, 'CalendarEntryEnvelope', 'Created'), 409: err('VEHICLE_CALENDAR_CONFLICT (details.conflicts)') } });
registry.registerPath({ method: 'delete', path: '/vehicles/{id}/calendar/blocks/{entryId}', tags: ['vehicles'], summary: 'Release an owner block', security: bearer, request: { params: calendarEntryParams }, responses: { 204: { description: 'Released' }, 404: err('NOT_FOUND'), 422: err('VEHICLE_INVALID_TRANSITION — not an owner block') } });
registry.registerPath({ method: 'get', path: '/vehicles/{id}/availability', tags: ['vehicles'], summary: 'Usable for [from, to)? dispatchability + calendar + document expiry — what the bid form calls', security: bearer, request: { params: idParams, query: calendarWindowQuery }, responses: { 200: ok(availability, 'VehicleAvailabilityEnvelope') } });
registry.registerPath({ method: 'get', path: '/vehicles/{id}/drivers', tags: ['vehicles'], summary: 'Assignment history, newest first (never overwritten)', security: bearer, request: { params: idParams }, responses: { 200: ok(z.array(assignment), 'VehicleAssignmentListEnvelope') } });
registry.registerPath({ method: 'post', path: '/vehicles/{id}/drivers', tags: ['vehicles'], summary: 'Open an assignment; a new primary closes the previous primary (drivers.assign)', security: bearer, request: { params: idParams, body: json(assignDriverBody) }, responses: { 201: ok(assignment, 'VehicleAssignmentEnvelope', 'Created'), 409: err('CONFLICT — already assigned'), 422: err('DRIVER_NOT_APPROVED / DRIVER_LICENSE_EXPIRED / VALIDATION_FAILED') } });
registry.registerPath({ method: 'delete', path: '/vehicles/{id}/drivers/{assignmentId}', tags: ['vehicles'], summary: 'Close an assignment (sets assigned_to)', security: bearer, request: { params: assignmentParams, body: json(unassignDriverBody) }, responses: { 204: { description: 'Closed' }, 409: err('DRIVER_ALREADY_ON_TRIP') } });

// ── reference catalogue ──────────────────────────────────────────────────────
const cached = 'Public, cacheable: ETag + Cache-Control public/max-age=300; 304 on If-None-Match';
const region = z.object({ id: z.string().uuid(), code: z.string(), nameEn: z.string(), nameAr: z.string() }).openapi('Region');
const city = region.extend({ regionId: z.string().uuid(), latitude: z.number(), longitude: z.number(), isActive: z.boolean() }).openapi('City');
const category = z
  .object({
    id: z.string().uuid(), code: z.string(), nameEn: z.string(), nameAr: z.string(), transportType: z.enum(['PASSENGER', 'GOODS']), descriptionEn: z.string().nullable(), descriptionAr: z.string().nullable(), iconKey: z.string().nullable(),
    minPassengerCapacity: z.number().int().nullable(), maxPassengerCapacity: z.number().int().nullable(), minPayloadKg: dec, maxPayloadKg: dec, requiresSpecialLicense: z.boolean(), sortOrder: z.number().int(), isActive: z.boolean(),
  })
  .openapi('VehicleCategory');
const make = z.object({ id: z.string().uuid(), name: z.string(), isActive: z.boolean() }).openapi('VehicleMake');
const model = z.object({ id: z.string().uuid(), makeId: z.string().uuid(), name: z.string(), bodyType: z.string().nullable(), isActive: z.boolean() }).openapi('VehicleModel');
const documentType = z
  .object({ code: z.string(), nameEn: z.string(), nameAr: z.string(), appliesTo: z.string(), transportType: z.string().nullable(), requiresExpiry: z.boolean(), isMandatory: z.boolean(), maxSizeBytes: z.number().int(), allowedMimeTypes: z.array(z.string()), expiryWarningDays: z.number().int(), sortOrder: z.number().int(), isActive: z.boolean() })
  .openapi('DocumentType');
const coded = z.object({ id: z.string().uuid(), code: z.string(), nameEn: z.string(), nameAr: z.string(), isActive: z.boolean(), sortOrder: z.number().int() }).openapi('CodedLabel');

registry.registerPath({ method: 'get', path: '/vehicle-categories', tags: ['reference'], summary: `Vehicle categories. ${cached}`, request: { query: listCategoriesQuery }, responses: { 200: ok(z.array(category), 'VehicleCategoryListEnvelope'), 304: { description: 'Not modified' } } });
registry.registerPath({ method: 'post', path: '/vehicle-categories', tags: ['reference'], summary: 'Create a category (reference.manage)', security: bearer, request: { body: json(createCategoryBody) }, responses: { 201: ok(category, 'VehicleCategoryEnvelope', 'Created'), 409: err('CONFLICT') } });
registry.registerPath({ method: 'patch', path: '/vehicle-categories/{id}', tags: ['reference'], summary: 'Update a category (reference.manage)', security: bearer, request: { params: idParams, body: json(patchCategoryBody) }, responses: { 200: ok(category, 'VehicleCategoryEnvelope'), 404: err('NOT_FOUND') } });
registry.registerPath({ method: 'delete', path: '/vehicle-categories/{id}', tags: ['reference'], summary: 'Deactivate a category (reference.manage) — never hard-deleted', security: bearer, request: { params: idParams }, responses: { 200: ok(category, 'VehicleCategoryEnvelope') } });
registry.registerPath({ method: 'get', path: '/reference/regions', tags: ['reference'], summary: `KSA regions. ${cached}`, responses: { 200: ok(z.array(region), 'RegionListEnvelope') } });
registry.registerPath({ method: 'get', path: '/reference/cities', tags: ['reference'], summary: `Cities with coordinates. ${cached}`, request: { query: listCitiesQuery }, responses: { 200: ok(z.array(city), 'CityListEnvelope') } });
registry.registerPath({ method: 'get', path: '/reference/vehicle-makes', tags: ['reference'], summary: `Vehicle makes. ${cached}`, responses: { 200: ok(z.array(make), 'VehicleMakeListEnvelope') } });
registry.registerPath({ method: 'post', path: '/reference/vehicle-makes', tags: ['reference'], summary: 'Add a make (reference.manage)', security: bearer, request: { body: json(createMakeBody) }, responses: { 201: ok(make, 'VehicleMakeEnvelope', 'Created'), 409: err('CONFLICT') } });
registry.registerPath({ method: 'get', path: '/reference/vehicle-models', tags: ['reference'], summary: `Vehicle models. ${cached}`, request: { query: listModelsQuery }, responses: { 200: ok(z.array(model), 'VehicleModelListEnvelope') } });
registry.registerPath({ method: 'post', path: '/reference/vehicle-models', tags: ['reference'], summary: 'Add a model (reference.manage)', security: bearer, request: { body: json(createModelBody) }, responses: { 201: ok(model, 'VehicleModelEnvelope', 'Created'), 409: err('CONFLICT') } });
registry.registerPath({ method: 'get', path: '/reference/document-types', tags: ['reference'], summary: `Document types with uploader constraints. ${cached}`, request: { query: listDocumentTypesQuery }, responses: { 200: ok(z.array(documentType), 'DocumentTypeListEnvelope') } });
registry.registerPath({ method: 'get', path: '/reference/expense-categories', tags: ['reference'], summary: `Expense categories. ${cached}`, responses: { 200: ok(z.array(coded), 'CodedLabelListEnvelope') } });
registry.registerPath({ method: 'get', path: '/reference/maintenance-service-types', tags: ['reference'], summary: `Maintenance service types. ${cached}`, responses: { 200: ok(z.array(coded), 'CodedLabelListEnvelope') } });
registry.registerPath({ method: 'get', path: '/reference/enums', tags: ['reference'], summary: `Every domain enum and transition map. ${cached}`, responses: { 200: ok(z.record(z.unknown()), 'EnumCatalogueEnvelope') } });
