import { z } from 'zod';
import { listSettingsQuery, updateSettingBody, updateSettingParams } from '@unigate/validation';
import { registry, successEnvelope } from '@/docs/registry.js';

const setting = z
  .object({
    key: z.string(),
    section: z.string(),
    value: z.unknown(),
    valueType: z.string(),
    scope: z.enum(['PUBLIC', 'INTERNAL']),
    descriptionEn: z.string(),
    descriptionAr: z.string(),
    isCodeManaged: z.boolean(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Setting');

const section = z
  .object({ section: z.string(), keyCount: z.number().int(), lastChangedAt: z.string().datetime().nullable() })
  .openapi('SettingsSection');

registry.registerPath({
  method: 'get', path: '/settings/public', tags: ['settings'], summary: 'PUBLIC-scoped settings, unauthenticated',
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: successEnvelope(z.array(setting), 'SettingListEnvelope') } } } },
});
registry.registerPath({
  method: 'get', path: '/settings', tags: ['settings'], summary: 'PUBLIC + INTERNAL settings (SECRET never returned)',
  request: { query: listSettingsQuery },
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: successEnvelope(z.array(setting), 'SettingListEnvelope') } } } },
});
registry.registerPath({
  method: 'get', path: '/settings/sections', tags: ['settings'], summary: 'Sections with key counts',
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'OK', content: { 'application/json': { schema: successEnvelope(z.array(section), 'SettingsSectionListEnvelope') } } } },
});
registry.registerPath({
  method: 'put', path: '/settings/{key}', tags: ['settings'], summary: 'Update one setting (validated, audited, never rewrites history)',
  request: { params: updateSettingParams, body: { content: { 'application/json': { schema: updateSettingBody } } } },
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: successEnvelope(setting, 'SettingEnvelope') } } },
    409: { description: 'SETTINGS_KEY_IMMUTABLE', content: { 'application/json': { schema: z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never) } } },
    422: { description: 'SETTINGS_VALUE_INVALID', content: { 'application/json': { schema: z.object({}).openapi({ $ref: '#/components/schemas/ErrorEnvelope' } as never) } } },
  },
});
