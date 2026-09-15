import { z } from 'zod';
import { SETTINGS_SECTION } from '@unigate/types';

export const settingsSection = z.enum(SETTINGS_SECTION);

/** `section.name` — lowercase, dotted, no whitespace. */
export const settingKey = z.string().regex(/^[a-z]+\.[a-z0-9_.]+$/, 'must be section.name');

export const listSettingsQuery = z.object({
  section: settingsSection.optional(),
});

export const updateSettingParams = z.object({ key: settingKey });

/** Value is validated against the per-key schema in the registry, not here. */
export const updateSettingBody = z.object({ value: z.unknown() }).strict();
