import { z } from 'zod';
import { DOCUMENT_APPLIES_TO, TRANSPORT_TYPE } from '@unigate/types';
import { safeText, uuid } from './primitives.js';

/** Reference catalogue schemas (api.md §8.9). Reads are public and cacheable; writes need reference.manage. */

const boolQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const listCategoriesQuery = z.object({ transportType: z.enum(TRANSPORT_TYPE).optional(), isActive: boolQuery });
export const listCitiesQuery = z.object({ regionId: uuid.optional(), q: safeText(80).optional(), isActive: boolQuery });
export const listModelsQuery = z.object({ makeId: uuid.optional(), isActive: boolQuery });
export const listDocumentTypesQuery = z.object({ appliesTo: z.enum(DOCUMENT_APPLIES_TO).optional(), isActive: boolQuery });

export const createMakeBody = z.object({ name: safeText(80).pipe(z.string().min(2)) }).strict();
export const createModelBody = z.object({ makeId: uuid, name: safeText(80).pipe(z.string().min(1)), bodyType: safeText(48).optional() }).strict();

export const createCategoryBody = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/),
    nameEn: safeText(120).pipe(z.string().min(2)),
    nameAr: safeText(120).pipe(z.string().min(2)),
    transportType: z.enum(TRANSPORT_TYPE),
    descriptionEn: safeText(500).optional(),
    descriptionAr: safeText(500).optional(),
    iconKey: safeText(48).optional(),
    minPassengerCapacity: z.number().int().min(1).max(100).optional(),
    maxPassengerCapacity: z.number().int().min(1).max(100).optional(),
    minPayloadKg: z.number().positive().max(100_000).optional(),
    maxPayloadKg: z.number().positive().max(100_000).optional(),
    requiresSpecialLicense: z.boolean().default(false),
    sortOrder: z.number().int().min(0).default(0),
  })
  .strict();
export const patchCategoryBody = createCategoryBody.omit({ code: true }).partial().extend({ isActive: z.boolean().optional() }).strict().refine((b) => Object.keys(b).length > 0, { message: 'at least one field is required' });
