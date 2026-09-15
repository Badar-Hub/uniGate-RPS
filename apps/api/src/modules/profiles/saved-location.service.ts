import type { Prisma } from '@prisma/client';
import type { ActorScope, SavedLocationDto } from '@unigate/types';
import type { patchSavedLocationBody, savedLocationBody } from '@unigate/validation';
import type { z } from 'zod';
import { BusinessRuleError, NotFoundError } from '@/common/errors.js';
import { newId } from '@/common/ids.js';
import { prisma } from '@/database/prisma.js';
import { toSavedLocationDto } from './profiles.mapper.js';

/** Customer address book under /me (api.md §8.2). Always SELF scope: bound to the actor's customer profile. */

const MAX_SAVED_LOCATIONS = 50;

function profileOf(scope: ActorScope): string {
  const id = scope.actor.customerProfileId;
  if (!id) throw new BusinessRuleError('VALIDATION_FAILED', 'A customer profile is required for saved locations', { fieldErrors: {}, formErrors: ['customer profile required'] });
  return id;
}

export async function listSavedLocations(scope: ActorScope): Promise<SavedLocationDto[]> {
  if (!scope.actor.customerProfileId) return [];
  const rows = await prisma().savedLocation.findMany({ where: { customerProfileId: scope.actor.customerProfileId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
  return rows.map(toSavedLocationDto);
}

export async function createSavedLocation(scope: ActorScope, body: z.infer<typeof savedLocationBody>): Promise<SavedLocationDto> {
  const customerProfileId = profileOf(scope);
  const count = await prisma().savedLocation.count({ where: { customerProfileId, deletedAt: null } });
  if (count >= MAX_SAVED_LOCATIONS) throw new BusinessRuleError('VALIDATION_FAILED', 'Saved-location limit reached', { fieldErrors: {}, formErrors: [`at most ${MAX_SAVED_LOCATIONS} saved locations`] });
  if (!(await prisma().city.findFirst({ where: { id: body.cityId, isActive: true }, select: { id: true } }))) {
    throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown city', { fieldErrors: { cityId: ['unknown or inactive city'] }, formErrors: [] });
  }
  const row = await prisma().savedLocation.create({ data: { id: newId(), customerProfileId, label: body.label, addressLine: body.addressLine, cityId: body.cityId, latitude: body.latitude, longitude: body.longitude, placeId: body.placeId ?? null } });
  return toSavedLocationDto(row);
}

export async function patchSavedLocation(scope: ActorScope, id: string, body: z.infer<typeof patchSavedLocationBody>): Promise<SavedLocationDto> {
  const customerProfileId = profileOf(scope);
  const existing = await prisma().savedLocation.findFirst({ where: { id, customerProfileId, deletedAt: null }, select: { id: true } });
  if (!existing) throw new NotFoundError();
  if (body.cityId && !(await prisma().city.findFirst({ where: { id: body.cityId, isActive: true }, select: { id: true } }))) {
    throw new BusinessRuleError('VALIDATION_FAILED', 'Unknown city', { fieldErrors: { cityId: ['unknown or inactive city'] }, formErrors: [] });
  }
  const data: Prisma.SavedLocationUncheckedUpdateInput = {
    ...(body.label !== undefined ? { label: body.label } : {}),
    ...(body.addressLine !== undefined ? { addressLine: body.addressLine } : {}),
    ...(body.cityId !== undefined ? { cityId: body.cityId } : {}),
    ...(body.latitude !== undefined ? { latitude: body.latitude } : {}),
    ...(body.longitude !== undefined ? { longitude: body.longitude } : {}),
    ...(body.placeId !== undefined ? { placeId: body.placeId } : {}),
  };
  const row = await prisma().savedLocation.update({ where: { id }, data });
  return toSavedLocationDto(row);
}

export async function deleteSavedLocation(scope: ActorScope, id: string): Promise<void> {
  const customerProfileId = profileOf(scope);
  const existing = await prisma().savedLocation.findFirst({ where: { id, customerProfileId, deletedAt: null }, select: { id: true } });
  if (!existing) throw new NotFoundError();
  await prisma().savedLocation.update({ where: { id }, data: { deletedAt: new Date() } });
}
