import type { Prisma } from '@prisma/client';
import { prisma } from '@/database/prisma.js';
import type { AnyScope, SettingDto, SettingsSectionDto } from '@unigate/types';
import { BusinessRuleError, ConflictError, NotFoundError } from '@/common/errors.js';
import { logger } from '@/logging/logger.js';
import { writeAudit } from '@/modules/platform/audit.service.js';
import { toSectionDto, toSettingDto } from './settings.mapper.js';
import { CROSS_FIELD_RULES, SETTINGS_BY_KEY } from './settings.registry.js';
import * as repo from './settings.repository.js';

export async function listSettings(scope: AnyScope, section?: string): Promise<SettingDto[]> {
  const rows = await repo.listSettings(scope, section ? { section } : {});
  return rows.map(toSettingDto);
}

export async function listPublicSettings(scope: AnyScope): Promise<SettingDto[]> {
  const rows = await repo.listSettings(scope, { publicOnly: true });
  return rows.map(toSettingDto);
}

export async function listSections(scope: AnyScope): Promise<SettingsSectionDto[]> {
  const rows = await repo.sectionSummary(scope);
  return rows.map(toSectionDto);
}

/**
 * PUT /settings/{key} — validated against the per-key schema and the cross-field rules,
 * refused for code-managed keys, audited at NOTICE with before/after. Never rewrites history:
 * values that affect money or commitments are snapshotted where they are used (ADR-009 §5).
 */
export async function updateSetting(
  scope: AnyScope,
  key: string,
  rawValue: unknown,
  actorUserId: string | null,
): Promise<SettingDto> {
  const definition = SETTINGS_BY_KEY.get(key);
  const current = await repo.findSetting(scope, key);
  if (!definition || !current) throw new NotFoundError('NOT_FOUND', 'Setting not found');
  if (definition.codeManaged || current.isCodeManaged) {
    throw new ConflictError('SETTINGS_KEY_IMMUTABLE', `${key} is code-managed and cannot be changed through the API`);
  }

  const parsed = definition.schema.safeParse(rawValue);
  if (!parsed.success) {
    throw new BusinessRuleError('SETTINGS_VALUE_INVALID', `Invalid value for ${key}`, {
      fieldErrors: { value: parsed.error.issues.map((i) => i.message) },
    });
  }
  const value = parsed.data as unknown;

  const merged = await repo.allValues(scope);
  merged.set(key, value);
  for (const rule of CROSS_FIELD_RULES) {
    if (rule.keys.includes(key) && !rule.check(merged)) {
      throw new BusinessRuleError('SETTINGS_VALUE_INVALID', rule.message, { keys: rule.keys });
    }
  }

  const updated = await repo.updateSettingValue(scope, key, value as Prisma.InputJsonValue, actorUserId);
  await writeAudit({
    actorUserId,
    actorType: actorUserId ? 'USER' : 'SYSTEM',
    action: 'setting.updated',
    entityType: 'system_setting',
    entityId: key,
    severity: 'NOTICE',
    beforeValue: { value: current.value },
    afterValue: { value },
    changedFields: ['value'],
  });
  invalidateSettingCache(key);
  logger().info({ key }, 'setting updated');
  return toSettingDto(updated);
}

// ── runtime reads ────────────────────────────────────────────────────────────

const VALUE_TTL_MS = 30_000;
const valueCache = new Map<string, { value: unknown; at: number }>();

/**
 * Reads one setting at the moment of use (ADR-009 §5). Short in-process cache; callers that
 * snapshot the value onto a record must do so explicitly. Falls back to the registry seed
 * when the row is missing (e.g. a key added in code before the seed ran) and to `fallback`
 * only if the key is unknown to the registry — which is a defect, and is logged.
 */
export async function getSettingValue<T>(key: string, fallback: T): Promise<T> {
  const hit = valueCache.get(key);
  if (hit && Date.now() - hit.at < VALUE_TTL_MS) return hit.value as T;
  const row = await prisma().systemSetting.findUnique({ where: { key }, select: { value: true } });
  let value: unknown;
  if (row) value = row.value;
  else {
    const def = SETTINGS_BY_KEY.get(key);
    if (def) value = def.seed;
    else {
      logger().error({ key }, 'setting read for a key absent from the registry — this is a defect');
      value = fallback;
    }
  }
  valueCache.set(key, { value, at: Date.now() });
  return (value ?? fallback) as T;
}

export function invalidateSettingCache(key?: string): void {
  if (key) valueCache.delete(key);
  else valueCache.clear();
}
