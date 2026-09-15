import type { SettingDto, SettingsSectionDto } from '@unigate/types';
import type { SettingRow } from './settings.repository.js';

/** Explicit allow-list — never a spread (security.md T-07). SECRET rows never reach here. */
export function toSettingDto(row: SettingRow): SettingDto {
  return {
    key: row.key,
    section: row.section,
    value: row.value,
    valueType: row.valueType,
    scope: row.scope === 'PUBLIC' ? 'PUBLIC' : 'INTERNAL',
    descriptionEn: row.descriptionEn,
    descriptionAr: row.descriptionAr,
    isCodeManaged: row.isCodeManaged,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toSectionDto(row: { section: string; keyCount: number; lastChangedAt: Date | null }): SettingsSectionDto {
  return {
    section: row.section,
    keyCount: row.keyCount,
    lastChangedAt: row.lastChangedAt ? row.lastChangedAt.toISOString() : null,
  };
}
