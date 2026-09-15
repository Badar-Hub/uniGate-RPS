-- ─────────────────────────────────────────────────────────────────────────────
-- Hand-written constraints, indexes, partitions, sequences and grants.
-- Everything here is something Prisma's schema language cannot express
-- (database.md §1 "Prisma limitation"). Each object is asserted to exist by
-- test/db/migration-integrity.test.ts after `migrate deploy` on a clean database.
-- Security review is mandatory for any change to this file (security.md §10.3).
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Human-readable reference sequences (gapless numbering is enforced in the
--    service under a lock for invoices; the others may have gaps on rollback)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SEQUENCE IF NOT EXISTS seq_trip_request_number START 1;
CREATE SEQUENCE IF NOT EXISTS seq_bid_number          START 1;
CREATE SEQUENCE IF NOT EXISTS seq_booking_number      START 1;
CREATE SEQUENCE IF NOT EXISTS seq_trip_number         START 1;
CREATE SEQUENCE IF NOT EXISTS seq_payment_number      START 1;
CREATE SEQUENCE IF NOT EXISTS seq_refund_number       START 1;
CREATE SEQUENCE IF NOT EXISTS seq_settlement_number   START 1;
CREATE SEQUENCE IF NOT EXISTS seq_invoice_number      START 1;
CREATE SEQUENCE IF NOT EXISTS seq_complaint_number    START 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Partial unique indexes
-- ═══════════════════════════════════════════════════════════════════════════

-- users: email/phone unique WHERE NOT NULL (§5.1) — soft-deleted rows keep theirs
CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_users_phone ON users (phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL;

-- exactly one platform-owned fleet row (A-57)
CREATE UNIQUE INDEX uq_owner_profiles_platform_fleet ON owner_profiles (is_platform_fleet) WHERE is_platform_fleet = true;

-- blind indexes are unique where present (§6.2)
CREATE UNIQUE INDEX uq_owner_profiles_national_id_bi ON owner_profiles (national_id_blind_index) WHERE national_id_blind_index IS NOT NULL;
CREATE UNIQUE INDEX uq_driver_profiles_national_id_bi ON driver_profiles (national_id_blind_index) WHERE national_id_blind_index IS NOT NULL;
CREATE UNIQUE INDEX uq_driver_profiles_license_bi ON driver_profiles (license_number_blind_index) WHERE license_number_blind_index IS NOT NULL;
CREATE UNIQUE INDEX uq_gps_devices_sim_bi ON gps_devices (sim_number_blind_index) WHERE sim_number_blind_index IS NOT NULL;

-- one active SPO assignment per customer (§6.2)
CREATE UNIQUE INDEX uq_spo_customer_assignments_active ON spo_customer_assignments (customer_profile_id) WHERE unassigned_at IS NULL;

-- one default SPO commission model
CREATE UNIQUE INDEX uq_spo_commission_models_default ON spo_commission_models (is_default) WHERE is_default = true;

-- vehicles: plate unique among live rows, normalised (§7.1); VIN unique where present
CREATE UNIQUE INDEX uq_vehicles_plate ON vehicles (LOWER(REPLACE(plate_number_en, ' ', ''))) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX uq_vehicles_vin ON vehicles (vin) WHERE vin IS NOT NULL AND deleted_at IS NULL;

-- one primary current driver per vehicle (§7.2)
CREATE UNIQUE INDEX uq_vehicle_primary_driver ON vehicle_driver_assignments (vehicle_id) WHERE assigned_to IS NULL AND is_primary = true;

-- the same vehicle cannot be offered twice on one request (§9.1)
CREATE UNIQUE INDEX uq_bids_active_vehicle_per_request ON bids (trip_request_id, vehicle_id) WHERE status = 'SUBMITTED';

-- a booking can never be settled twice (§12.5)
CREATE UNIQUE INDEX uq_settlement_lines_booking_earning ON settlement_lines (booking_id) WHERE line_type = 'BOOKING_EARNING';

-- one default payout account per owner
CREATE UNIQUE INDEX uq_owner_bank_accounts_default ON owner_bank_accounts (owner_profile_id) WHERE is_default = true AND deleted_at IS NULL;

-- one default payment token per customer
CREATE UNIQUE INDEX uq_payment_method_tokens_default ON payment_method_tokens (customer_profile_id) WHERE is_default = true AND deleted_at IS NULL;

-- notifications dedupe on retry (§13.3)
CREATE UNIQUE INDEX uq_notifications_dedupe ON notifications (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- e-invoice counter is unique per issuing solution (§12.7)
CREATE UNIQUE INDEX uq_invoices_icv ON invoices (icv) WHERE icv IS NOT NULL;

-- a booking can never appear on two live invoices as a BOOKING line (§12.6);
-- ORDER lines are guarded by invoice_line_bookings.booking_id UNIQUE (schema)
CREATE UNIQUE INDEX uq_invoice_lines_booking ON invoice_lines (booking_id) WHERE line_type = 'BOOKING' AND booking_id IS NOT NULL;

-- exactly one active GLOBAL commission rule at a time (§12.3) — deletion of the last is
-- blocked in the service; this index blocks a second
CREATE UNIQUE INDEX uq_commission_rules_single_global_active ON commission_rules (scope) WHERE scope = 'GLOBAL' AND is_active = true AND effective_to IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. CHECK constraints
-- ═══════════════════════════════════════════════════════════════════════════

-- an account must be reachable (§5.1)
ALTER TABLE users ADD CONSTRAINT ck_users_identifier CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL);
ALTER TABLE users ADD CONSTRAINT ck_users_locale CHECK (preferred_locale IN ('ar', 'en'));

-- documents: exactly one owner FK (§6.1, D10)
ALTER TABLE documents ADD CONSTRAINT ck_documents_single_owner CHECK (
  num_nonnulls(user_id, owner_profile_id, driver_profile_id, vehicle_id,
               corporate_customer_profile_id, expense_id, maintenance_record_id, trip_proof_id) = 1
);

-- corporate buyer identifiers (FR-PROFILES-14)
ALTER TABLE corporate_customer_profiles ADD CONSTRAINT ck_corporate_cr_number CHECK (cr_number ~ '^[0-9]{10}$');
ALTER TABLE corporate_customer_profiles ADD CONSTRAINT ck_corporate_postal_code CHECK (address_postal_code IS NULL OR address_postal_code ~ '^[0-9]{5}$');
ALTER TABLE corporate_customer_profiles ADD CONSTRAINT ck_corporate_building_number CHECK (address_building_number IS NULL OR address_building_number ~ '^[0-9]{4}$');
ALTER TABLE corporate_customer_profiles ADD CONSTRAINT ck_corporate_additional_number CHECK (address_additional_number IS NULL OR address_additional_number ~ '^[0-9]{4}$');
ALTER TABLE corporate_customer_profiles ADD CONSTRAINT ck_corporate_credit_limit CHECK (credit_limit_amount >= 0);
ALTER TABLE corporate_customer_profiles ADD CONSTRAINT ck_corporate_credit_terms CHECK (credit_terms_days BETWEEN 0 AND 120);

-- KSA VAT numbers: 15 digits, first and last are 3
ALTER TABLE customer_profiles ADD CONSTRAINT ck_customer_vat_number CHECK (vat_number IS NULL OR vat_number ~ '^3[0-9]{13}3$');
ALTER TABLE owner_profiles ADD CONSTRAINT ck_owner_vat_number CHECK (vat_number IS NULL OR vat_number ~ '^3[0-9]{13}3$');
ALTER TABLE owner_profiles ADD CONSTRAINT ck_owner_platform_fleet_type CHECK (is_platform_fleet = false OR owner_type = 'PLATFORM');

-- vehicles (§7.1)
ALTER TABLE vehicles ADD CONSTRAINT ck_vehicles_year CHECK (model_year BETWEEN 1980 AND EXTRACT(YEAR FROM CURRENT_DATE)::int + 2);
ALTER TABLE vehicles ADD CONSTRAINT ck_vehicles_capacity CHECK (passenger_capacity IS NOT NULL OR payload_capacity_kg IS NOT NULL);
ALTER TABLE vehicles ADD CONSTRAINT ck_vehicles_capacity_positive CHECK (
  (passenger_capacity IS NULL OR passenger_capacity > 0) AND (payload_capacity_kg IS NULL OR payload_capacity_kg > 0)
);

-- driver assignments (§7.2)
ALTER TABLE vehicle_driver_assignments ADD CONSTRAINT ck_assignment_period CHECK (assigned_to IS NULL OR assigned_to > assigned_from);

-- calendar entries: the FK that matches the type must be set
ALTER TABLE vehicle_calendar_entries ADD CONSTRAINT ck_calendar_entry_reference CHECK (
  (entry_type = 'RESERVATION' AND booking_id IS NOT NULL AND maintenance_record_id IS NULL) OR
  (entry_type = 'MAINTENANCE' AND maintenance_record_id IS NOT NULL AND booking_id IS NULL) OR
  (entry_type = 'OWNER_BLOCK' AND booking_id IS NULL AND maintenance_record_id IS NULL)
);
ALTER TABLE vehicle_calendar_entries ADD CONSTRAINT ck_calendar_entry_period CHECK (NOT isempty(period) AND lower_inc(period) AND NOT upper_inc(period));

-- trip requests (§8.1)
ALTER TABLE trip_requests ADD CONSTRAINT ck_trip_requests_vehicles_required CHECK (vehicles_required >= 1);
ALTER TABLE trip_requests ADD CONSTRAINT ck_trip_requests_return CHECK (trip_direction = 'ONE_WAY' OR return_at IS NOT NULL);
ALTER TABLE trip_requests ADD CONSTRAINT ck_trip_requests_times CHECK (pickup_at > created_at AND (return_at IS NULL OR return_at > pickup_at));
ALTER TABLE trip_requests ADD CONSTRAINT ck_trip_requests_counters CHECK (
  vehicles_awarded <= vehicles_required AND vehicles_completed <= vehicles_awarded AND vehicles_dispatched <= vehicles_awarded
  AND vehicles_awarded >= 0 AND vehicles_dispatched >= 0 AND vehicles_completed >= 0 AND vehicles_cancelled >= 0
);
ALTER TABLE trip_requests ADD CONSTRAINT ck_trip_requests_partial CHECK (
  allow_partial_fulfilment = true OR vehicles_required = 1 OR status <> 'PARTIALLY_AWARDED'
);
ALTER TABLE trip_requests ADD CONSTRAINT ck_trip_requests_coordinates CHECK (
  pickup_latitude BETWEEN -90 AND 90 AND pickup_longitude BETWEEN -180 AND 180 AND
  dropoff_latitude BETWEEN -90 AND 90 AND dropoff_longitude BETWEEN -180 AND 180
);
-- commission override: shape follows type (§12.3)
ALTER TABLE trip_requests ADD CONSTRAINT ck_trip_requests_commission_override CHECK (
  commission_override_type IS NULL
  OR (commission_override_type = 'NONE' AND commission_override_value IS NULL)
  OR (commission_override_type = 'PERCENTAGE' AND commission_override_value BETWEEN 0 AND 100)
  OR (commission_override_type = 'FIXED' AND commission_override_value >= 0)
);

-- passenger / goods details
ALTER TABLE passenger_trip_details ADD CONSTRAINT ck_passenger_count CHECK (passenger_count >= 1 AND luggage_count >= 0 AND child_seats_required >= 0);
ALTER TABLE goods_trip_details ADD CONSTRAINT ck_goods_weight CHECK (cargo_weight_kg > 0);
ALTER TABLE goods_trip_details ADD CONSTRAINT ck_goods_temperature CHECK (
  required_temperature_min_c IS NULL OR required_temperature_max_c IS NULL OR required_temperature_min_c <= required_temperature_max_c
);

-- bids (§9.1)
ALTER TABLE bids ADD CONSTRAINT ck_bids_amounts CHECK (base_amount > 0 AND extras_amount >= 0 AND vat_amount >= 0 AND total_amount > 0);
ALTER TABLE bids ADD CONSTRAINT ck_bids_valid_until CHECK (valid_until > submitted_at);
ALTER TABLE bids ADD CONSTRAINT ck_bids_vat_rate CHECK (vat_rate BETWEEN 0 AND 1);

-- bookings
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_schedule CHECK (scheduled_end_at > scheduled_start_at);
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_amounts CHECK (agreed_base_amount > 0 AND agreed_extras_amount >= 0 AND vat_amount >= 0 AND total_amount > 0);
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_fulfilment_sequence CHECK (fulfilment_sequence >= 1);
-- INVOICED bookings never wait for payment (A-46): the expiry column stays NULL
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_invoiced_no_payment_due CHECK (billing_mode <> 'INVOICED' OR payment_due_by IS NULL);
ALTER TABLE bookings ADD CONSTRAINT ck_bookings_invoiced_terms CHECK (billing_mode <> 'INVOICED' OR credit_terms_days_snapshot IS NOT NULL);

-- cancellations
ALTER TABLE booking_cancellations ADD CONSTRAINT ck_cancellation_amounts CHECK (cancellation_fee_amount >= 0 AND refund_amount >= 0 AND hours_before_pickup >= -8760);
ALTER TABLE cancellation_policies ADD CONSTRAINT ck_cancellation_policy_value CHECK (
  (charge_type = 'NONE' AND value IS NULL)
  OR (charge_type = 'PERCENTAGE' AND value BETWEEN 0 AND 100)
  OR (charge_type = 'FIXED' AND value >= 0)
  OR tiers IS NOT NULL
);
ALTER TABLE cancellation_policies ADD CONSTRAINT ck_cancellation_policy_scope CHECK (
  (scope = 'GLOBAL' AND vehicle_category_id IS NULL AND customer_profile_id IS NULL AND owner_profile_id IS NULL) OR
  (scope = 'VEHICLE_CATEGORY' AND vehicle_category_id IS NOT NULL) OR
  (scope = 'CUSTOMER' AND customer_profile_id IS NOT NULL) OR
  (scope = 'OWNER' AND owner_profile_id IS NOT NULL)
);

-- commission rules (§12.3)
ALTER TABLE commission_rules ADD CONSTRAINT ck_commission_rules_value CHECK (
  (calculation_type = 'NONE' AND percentage_rate IS NULL AND fixed_amount IS NULL)
  OR (calculation_type = 'PERCENTAGE' AND percentage_rate BETWEEN 0 AND 1 AND fixed_amount IS NULL)
  OR (calculation_type = 'FIXED' AND fixed_amount >= 0 AND percentage_rate IS NULL)
);
ALTER TABLE commission_rules ADD CONSTRAINT ck_commission_rules_scope CHECK (
  (scope = 'GLOBAL' AND vehicle_category_id IS NULL AND owner_profile_id IS NULL) OR
  (scope = 'VEHICLE_CATEGORY' AND vehicle_category_id IS NOT NULL AND owner_profile_id IS NULL) OR
  (scope = 'OWNER' AND owner_profile_id IS NOT NULL AND vehicle_category_id IS NULL) OR
  (scope = 'OWNER_CATEGORY' AND owner_profile_id IS NOT NULL AND vehicle_category_id IS NOT NULL)
);
ALTER TABLE commission_rules ADD CONSTRAINT ck_commission_rules_window CHECK (effective_to IS NULL OR effective_to > effective_from);
ALTER TABLE commission_rules ADD CONSTRAINT ck_commission_rules_bounds CHECK (min_amount IS NULL OR max_amount IS NULL OR min_amount <= max_amount);

-- financial snapshot balancing identity (§12.3) — asserted in code too; the DB is the backstop
ALTER TABLE booking_financial_snapshots ADD CONSTRAINT ck_snapshot_balances CHECK (
  owner_net_amount + commission_amount + commission_vat_amount + payment_fee_amount = gross_amount
);
ALTER TABLE booking_financial_snapshots ADD CONSTRAINT ck_snapshot_non_negative CHECK (
  gross_amount >= 0 AND vat_amount >= 0 AND commission_amount >= 0 AND commission_vat_amount >= 0 AND payment_fee_amount >= 0 AND owner_net_amount >= 0
);
-- deemed-supplier bookings carry no separate commission VAT (§12.8 point 4)
ALTER TABLE booking_financial_snapshots ADD CONSTRAINT ck_snapshot_commission_vat_by_treatment CHECK (
  vat_treatment <> 'DEEMED_SUPPLIER' OR commission_vat_amount = 0
);

-- payments: exactly one target (§12.6)
ALTER TABLE payments ADD CONSTRAINT ck_payments_single_target CHECK (num_nonnulls(booking_id, invoice_id) = 1);
ALTER TABLE payments ADD CONSTRAINT ck_payments_amount CHECK (amount > 0);
ALTER TABLE refunds ADD CONSTRAINT ck_refunds_amount_positive CHECK (amount > 0);
ALTER TABLE payment_transactions ADD CONSTRAINT ck_payment_transactions_amount CHECK (amount >= 0);

-- ledger: append-only in spirit; amounts positive, direction carries sign (§12.4)
ALTER TABLE ledger_entries ADD CONSTRAINT ck_ledger_amount_positive CHECK (amount > 0);

-- settlements
ALTER TABLE settlements ADD CONSTRAINT ck_settlements_period CHECK (period_end > period_start);
ALTER TABLE settlement_lines ADD CONSTRAINT ck_settlement_lines_hold CHECK (
  (hold_reason = 'NONE' AND held_since IS NULL) OR (hold_reason <> 'NONE' AND held_since IS NOT NULL) OR released_at IS NOT NULL
);

-- invoices (§12.6, §12.7)
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_amounts CHECK (subtotal_amount >= 0 AND vat_amount >= 0 AND total_amount >= 0 AND paid_amount >= 0 AND outstanding_amount >= 0);
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_outstanding CHECK (outstanding_amount <= total_amount);
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_dates CHECK (due_date >= issue_date);
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_correction CHECK (
  (invoice_type IN ('CREDIT_NOTE', 'DEBIT_NOTE') AND corrects_invoice_id IS NOT NULL) OR
  (invoice_type IN ('TAX_INVOICE', 'SIMPLIFIED_TAX_INVOICE') AND corrects_invoice_id IS NULL)
);
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_seller_vat CHECK (seller_vat_number ~ '^3[0-9]{13}3$');
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_buyer_vat CHECK (buyer_vat_number IS NULL OR buyer_vat_number ~ '^3[0-9]{13}3$');
-- a TAX_INVOICE names a registered buyer; a simplified one does not
ALTER TABLE invoices ADD CONSTRAINT ck_invoices_type_buyer CHECK (invoice_type <> 'TAX_INVOICE' OR buyer_vat_number IS NOT NULL);

ALTER TABLE invoice_lines ADD CONSTRAINT ck_invoice_lines_reference CHECK (
  (line_type = 'ORDER' AND trip_request_id IS NOT NULL AND booking_id IS NULL) OR
  (line_type = 'BOOKING' AND booking_id IS NOT NULL AND trip_request_id IS NULL) OR
  (line_type IN ('ADJUSTMENT', 'PENALTY', 'DISCOUNT'))
);
ALTER TABLE invoice_lines ADD CONSTRAINT ck_invoice_lines_vat_category CHECK (vat_category IN ('S', 'Z', 'E', 'O'));
ALTER TABLE invoice_lines ADD CONSTRAINT ck_invoice_lines_quantity CHECK (quantity > 0);

ALTER TABLE supplier_invoices ADD CONSTRAINT ck_supplier_invoices_amounts CHECK (net_amount >= 0 AND vat_amount >= 0 AND total_amount >= 0);
ALTER TABLE supplier_invoices ADD CONSTRAINT ck_supplier_invoices_seller_vat CHECK (seller_vat_number ~ '^3[0-9]{13}3$');
ALTER TABLE supplier_invoices ADD CONSTRAINT ck_supplier_invoices_self_billed_agreement CHECK (kind <> 'SELF_BILLED' OR agreement_id IS NOT NULL);
ALTER TABLE self_billing_agreements ADD CONSTRAINT ck_self_billing_agreements_status CHECK (
  status IN ('DRAFT', 'SIGNED', 'SUBMITTED_TO_ZATCA', 'ACTIVE', 'SUSPENDED', 'TERMINATED')
);
ALTER TABLE self_billing_agreements ADD CONSTRAINT ck_self_billing_agreements_active_needs_approval CHECK (status <> 'ACTIVE' OR zatca_approval_reference IS NOT NULL);

-- ratings (§13.2)
ALTER TABLE ratings ADD CONSTRAINT ck_ratings_score CHECK (score BETWEEN 1 AND 5);

-- expenses / maintenance
ALTER TABLE expenses ADD CONSTRAINT ck_expenses_amounts CHECK (amount >= 0 AND vat_amount >= 0 AND total_amount >= 0);
ALTER TABLE maintenance_records ADD CONSTRAINT ck_maintenance_schedule CHECK (scheduled_end_at > scheduled_start_at);
ALTER TABLE maintenance_records ADD CONSTRAINT ck_maintenance_amounts CHECK (cost_amount >= 0 AND vat_amount >= 0 AND total_amount >= 0);

-- otp
ALTER TABLE otp_requests ADD CONSTRAINT ck_otp_attempts CHECK (attempt_count >= 0 AND max_attempts BETWEEN 1 AND 10);

-- system settings key shape: section.name, and the key's prefix matches its section
ALTER TABLE system_settings ADD CONSTRAINT ck_system_settings_key CHECK (key ~ '^[a-z]+\.[a-z0-9_.]+$');
ALTER TABLE system_settings ADD CONSTRAINT ck_system_settings_key_section CHECK (split_part(key, '.', 1) = section::text);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. The availability guarantee — EXCLUDE (§7.3, ADR-004)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE vehicle_calendar_entries
  ADD CONSTRAINT ex_vehicle_calendar_no_overlap
  EXCLUDE USING gist (vehicle_id WITH =, period WITH &&)
  WHERE (status <> 'RELEASED');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Additional indexes (§14.2)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX idx_vehicles_plate_trgm ON vehicles USING gin (plate_number_en gin_trgm_ops);
CREATE INDEX idx_documents_expiry_verified ON documents (expiry_date) WHERE verification_status = 'VERIFIED';
CREATE INDEX idx_trip_requests_bidding_open ON trip_requests (bidding_closes_at) WHERE status = 'PUBLISHED';
CREATE INDEX idx_bookings_payment_expiry ON bookings (payment_due_by) WHERE status = 'PENDING_PAYMENT' AND payment_due_by IS NOT NULL;
CREATE INDEX idx_invoices_reporting_due ON invoices (reporting_due_at) WHERE reporting_due_at IS NOT NULL AND clearance_status = 'PENDING';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Partitions — audit_logs and vehicle_location_points are RANGE-partitioned
--    monthly. A default partition catches anything outside a created month so a
--    write never fails for want of a partition; the maintenance job (Phase 3+)
--    creates next month's partition ahead of time and detaches expired ones.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION ensure_month_partition(parent regclass, month_start date)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  part_name text := parent::text || '_' || to_char(month_start, 'YYYY_MM');
  range_start timestamptz := month_start;
  range_end   timestamptz := (month_start + interval '1 month');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)',
                   part_name, parent, range_start, range_end);
  END IF;
END $$;

CREATE TABLE audit_logs_default PARTITION OF audit_logs DEFAULT;
CREATE TABLE vehicle_location_points_default PARTITION OF vehicle_location_points DEFAULT;

-- current month and next month, so a fresh deployment never writes to the default partition
SELECT ensure_month_partition('audit_logs', date_trunc('month', CURRENT_DATE)::date);
SELECT ensure_month_partition('audit_logs', (date_trunc('month', CURRENT_DATE) + interval '1 month')::date);
SELECT ensure_month_partition('vehicle_location_points', date_trunc('month', CURRENT_DATE)::date);
SELECT ensure_month_partition('vehicle_location_points', (date_trunc('month', CURRENT_DATE) + interval '1 month')::date);

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Append-only audit trail at the DB-role level (security.md §8.3, T-34)
--    The runtime role (unigate_app in staging/production, created by the
--    infrastructure) gets INSERT + SELECT on audit_logs and explicitly NOT
--    UPDATE/DELETE. The migration role (owner) keeps full rights for migrations only.
--    Same policy for ledger_entries (§12.4 "append-only — corrections are reversing entries").
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unigate_app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA public TO unigate_app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO unigate_app';
    EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO unigate_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM unigate_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs_default FROM unigate_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON ledger_entries FROM unigate_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON booking_financial_snapshots FROM unigate_app';
    EXECUTE 'REVOKE UPDATE, DELETE, TRUNCATE ON payment_webhook_events FROM unigate_app';
    -- future partitions inherit through default privileges on the owner role
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO unigate_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO unigate_app';
  END IF;
END $$;

-- Belt and braces: a trigger that refuses UPDATE/DELETE on the audit trail for EVERY role,
-- so even the migration role cannot rewrite history without first dropping the trigger —
-- which is itself an auditable, reviewable act.
CREATE OR REPLACE FUNCTION refuse_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (security.md §8.3)', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER trg_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER trg_ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TRIGGER trg_booking_financial_snapshots_immutable
  BEFORE UPDATE OR DELETE ON booking_financial_snapshots
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();
