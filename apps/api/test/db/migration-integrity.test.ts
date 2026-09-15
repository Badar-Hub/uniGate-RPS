/**
 * Migration-integrity test (mitigates AR-1 in architecture.md).
 *
 * Runs `prisma migrate reset` against TEST_DATABASE_URL, then asserts that every object the
 * hand-written migration promises actually exists: extensions, the EXCLUDE constraint, each
 * partial unique index, each CHECK, partitioning, sequences, append-only triggers. It also
 * asserts three cross-artefact parities so drift between docs, types and database fails CI:
 *
 *   1. every PostgreSQL enum matches packages/types PG_ENUMS value-for-value
 *   2. the seeded permission catalogue matches architecture.md §6.2 code-for-code
 *   3. the settings registry matches docs/settings-catalogue.md key-for-key
 *
 * Skips with a clear message when TEST_DATABASE_URL is unset (e.g. a laptop without Docker).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PG_ENUMS } from '@unigate/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PERMISSIONS } from '../../prisma/seed/permissions.js';
import { SETTINGS } from '../../src/modules/reference/settings.registry.js';

const url = process.env['TEST_DATABASE_URL'] ?? '';
const describeDb = url ? describe : describe.skip;
if (!url) console.warn('TEST_DATABASE_URL is not set — skipping migration-integrity tests');

const apiRoot = path.resolve(import.meta.dirname, '../..');
const repoRoot = path.resolve(apiRoot, '../..');

describeDb('migration integrity', () => {
  let db: PrismaClient;

  beforeAll(() => {
    execSync('pnpm exec prisma migrate reset --force --skip-seed --skip-generate', {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
    });
    db = new PrismaClient({ datasources: { db: { url } } });
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const rows = async <T>(sql: TemplateStringsArray, ...values: unknown[]): Promise<T[]> =>
    db.$queryRaw<T[]>(sql, ...values);

  it('has every required extension', async () => {
    const r = await rows<{ extname: string }>`SELECT extname FROM pg_extension`;
    const names = r.map((x) => x.extname);
    for (const e of ['btree_gist', 'citext', 'pgcrypto', 'pg_trgm']) expect(names).toContain(e);
  });

  it('has the vehicle calendar EXCLUDE constraint, partial on status', async () => {
    const r = await rows<{ conname: string; contype: string; def: string }>`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE conname = 'ex_vehicle_calendar_no_overlap'`;
    expect(r).toHaveLength(1);
    expect(r[0]?.contype).toBe('x');
    expect(r[0]?.def).toContain('EXCLUDE USING gist');
    expect(r[0]?.def).toContain('&&');
    expect(r[0]?.def).toMatch(/WHERE \(\(status <> 'RELEASED'/);
  });

  it('has every partial unique index', async () => {
    const expected = [
      'uq_users_email', 'uq_users_phone', 'uq_owner_profiles_platform_fleet', 'uq_owner_profiles_national_id_bi',
      'uq_driver_profiles_national_id_bi', 'uq_driver_profiles_license_bi', 'uq_gps_devices_sim_bi',
      'uq_spo_customer_assignments_active', 'uq_spo_commission_models_default', 'uq_vehicles_plate', 'uq_vehicles_vin',
      'uq_vehicle_primary_driver', 'uq_bids_active_vehicle_per_request', 'uq_settlement_lines_booking_earning',
      'uq_owner_bank_accounts_default', 'uq_payment_method_tokens_default', 'uq_notifications_dedupe', 'uq_invoices_icv',
      'uq_invoice_lines_booking', 'uq_commission_rules_single_global_active',
    ];
    const r = await rows<{ indexname: string; indexdef: string }>`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
    const byName = new Map(r.map((x) => [x.indexname, x.indexdef]));
    for (const name of expected) {
      expect(byName.has(name), `missing index ${name}`).toBe(true);
      expect(byName.get(name), `${name} should be UNIQUE and partial`).toMatch(/CREATE UNIQUE INDEX .* WHERE /);
    }
  });

  it('has every CHECK constraint', async () => {
    const expected = [
      'ck_users_identifier', 'ck_documents_single_owner', 'ck_corporate_cr_number', 'ck_customer_vat_number', 'ck_owner_vat_number',
      'ck_owner_platform_fleet_type', 'ck_vehicles_year', 'ck_vehicles_capacity', 'ck_assignment_period', 'ck_calendar_entry_reference',
      'ck_calendar_entry_period', 'ck_trip_requests_vehicles_required', 'ck_trip_requests_return', 'ck_trip_requests_times',
      'ck_trip_requests_counters', 'ck_trip_requests_partial', 'ck_trip_requests_commission_override', 'ck_bids_amounts', 'ck_bids_valid_until',
      'ck_bookings_schedule', 'ck_bookings_invoiced_no_payment_due', 'ck_bookings_invoiced_terms', 'ck_cancellation_policy_value',
      'ck_cancellation_policy_scope', 'ck_commission_rules_value', 'ck_commission_rules_scope', 'ck_snapshot_balances',
      'ck_snapshot_commission_vat_by_treatment', 'ck_payments_single_target', 'ck_ledger_amount_positive', 'ck_invoices_correction',
      'ck_invoices_type_buyer', 'ck_invoice_lines_reference', 'ck_supplier_invoices_self_billed_agreement',
      'ck_self_billing_agreements_active_needs_approval', 'ck_ratings_score', 'ck_system_settings_key', 'ck_system_settings_key_section',
    ];
    const r = await rows<{ conname: string }>`SELECT conname FROM pg_constraint WHERE contype = 'c'`;
    const names = new Set(r.map((x) => x.conname));
    for (const name of expected) expect(names.has(name), `missing CHECK ${name}`).toBe(true);
  });

  it('partitions audit_logs and vehicle_location_points by range with a default and two months', async () => {
    for (const parent of ['audit_logs', 'vehicle_location_points']) {
      const p = await rows<{ partstrat: string }>`SELECT partstrat FROM pg_partitioned_table WHERE partrelid = ${parent}::regclass`;
      expect(p[0]?.partstrat, `${parent} should be RANGE partitioned`).toBe('r');
      const parts = await rows<{ relname: string }>`
        SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid WHERE i.inhparent = ${parent}::regclass`;
      const names = parts.map((x) => x.relname);
      expect(names).toContain(`${parent}_default`);
      expect(names.filter((n) => /_\d{4}_\d{2}$/.test(n)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('refuses UPDATE and DELETE on audit_logs, ledger_entries and booking_financial_snapshots', async () => {
    const r = await rows<{ tgname: string; tgrelid: string }>`
      SELECT tgname, tgrelid::regclass::text AS tgrelid FROM pg_trigger WHERE tgname LIKE 'trg_%' AND NOT tgisinternal`;
    const byTable = new Map(r.map((x) => [x.tgrelid, x.tgname]));
    expect(byTable.get('audit_logs')).toBe('trg_audit_logs_append_only');
    expect(byTable.get('ledger_entries')).toBe('trg_ledger_entries_append_only');
    expect(byTable.get('booking_financial_snapshots')).toBe('trg_booking_financial_snapshots_immutable');

    await db.$executeRaw`INSERT INTO audit_logs (id, actor_type, actor_roles, action, entity_type, entity_id, changed_fields, severity, occurred_at)
      VALUES ('0192f3c1-0000-7000-8000-0000000000aa', 'SYSTEM', '{}', 'test', 'x', '1', '{}', 'INFO', now())`;
    await expect(db.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE id = '0192f3c1-0000-7000-8000-0000000000aa'`).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM audit_logs WHERE id = '0192f3c1-0000-7000-8000-0000000000aa'`).rejects.toThrow(/append-only/);
  });

  it('has every reference-number sequence', async () => {
    const r = await rows<{ sequencename: string }>`SELECT sequencename FROM pg_sequences WHERE schemaname = 'public'`;
    const names = r.map((x) => x.sequencename);
    for (const s of ['seq_trip_request_number', 'seq_bid_number', 'seq_booking_number', 'seq_trip_number', 'seq_payment_number', 'seq_refund_number', 'seq_settlement_number', 'seq_invoice_number', 'seq_complaint_number']) {
      expect(names).toContain(s);
    }
  });

  it('every PostgreSQL enum matches @unigate/types value-for-value', async () => {
    const r = await rows<{ typname: string; labels: string[] }>`
      SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`;
    const dbEnums = new Map(r.map((x) => [x.typname, x.labels]));
    for (const [name, values] of Object.entries(PG_ENUMS)) {
      expect(dbEnums.has(name), `enum ${name} missing in database`).toBe(true);
      expect(dbEnums.get(name), `enum ${name} values differ`).toEqual([...values]);
    }
    for (const name of dbEnums.keys()) {
      expect(name in PG_ENUMS, `database enum ${name} is not declared in @unigate/types`).toBe(true);
    }
  });

  it('the permission seed matches architecture.md §6.2 code-for-code', () => {
    const md = readFileSync(path.join(repoRoot, 'docs/architecture.md'), 'utf8');
    const start = md.indexOf('### 6.2 The permission catalogue');
    const end = md.indexOf('**Conventions:**', start);
    const section = md.slice(start, end);
    const documented = new Set([...section.matchAll(/`([a-z_]+(?:\.[a-z_]+){1,2})`/g)].map((m) => m[1] ?? ''));
    const seeded = new Set(PERMISSIONS.map((p) => p.code));
    const missingFromSeed = [...documented].filter((c) => !seeded.has(c));
    const missingFromDocs = [...seeded].filter((c) => !documented.has(c));
    expect(missingFromSeed, 'documented in architecture.md but not seeded').toEqual([]);
    expect(missingFromDocs, 'seeded but not documented in architecture.md').toEqual([]);
  });

  it('the settings registry matches docs/settings-catalogue.md key-for-key', () => {
    const md = readFileSync(path.join(repoRoot, 'docs/settings-catalogue.md'), 'utf8');
    const documented = new Set([...md.matchAll(/^\| `([a-z]+\.[a-z0-9_.]+)` \|/gm)].map((m) => m[1] ?? ''));
    const inCode = new Set(SETTINGS.map((s) => s.key));
    expect([...documented].filter((k) => !inCode.has(k)), 'in catalogue but not in registry').toEqual([]);
    expect([...inCode].filter((k) => !documented.has(k)), 'in registry but not in catalogue').toEqual([]);
  });

  it('every settings key seed passes its own schema', () => {
    for (const s of SETTINGS) {
      const result = s.schema.safeParse(s.seed);
      expect(result.success, `${s.key} seed ${JSON.stringify(s.seed)} fails its schema`).toBe(true);
    }
  });

  it('.env.example lists every key the env schema knows', async () => {
    const { ENV_KEYS } = await import('@unigate/config');
    const example = readFileSync(path.join(repoRoot, '.env.example'), 'utf8');
    const present = new Set([...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1] ?? ''));
    const missing = ENV_KEYS.filter((k) => !present.has(k));
    expect(missing, 'keys required by the env schema but absent from .env.example').toEqual([]);
  });
});
