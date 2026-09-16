-- Least-privilege database roles (security.md §8.3, docs/hardening.md §7).
--
-- Two roles, never one:
--   * the OWNER role runs migrations (`prisma migrate deploy`) and owns every object;
--   * `unigate_app` is what the API and worker connect as (DATABASE_URL in staging/production).
--     It can read and write rows but cannot create, alter or drop anything, and it cannot
--     UPDATE / DELETE / TRUNCATE the append-only tables — the migration in
--     apps/api/prisma/migrations/20260915000001_constraints applies those revokes whenever the
--     role exists, and default privileges cover tables created later (partitions included).
--
-- Run ONCE per environment as the owner / superuser, before the first `prisma migrate deploy`:
--   psql "$OWNER_DATABASE_URL" -v app_password="'…'" -f scripts/db/roles.sql
-- The password comes from the secret store; never commit it. Rotate with:
--   ALTER ROLE unigate_app WITH PASSWORD '…';
-- Verify with scripts/db/audit-grants.sql.

\set ON_ERROR_STOP on

-- psql variables are not expanded inside DO blocks, so the conditional CREATE goes through \gexec.
SELECT format('CREATE ROLE unigate_app LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unigate_app')
\gexec

-- Connection ceiling: a runaway pool cannot exhaust the server (tune to pool_size × replicas).
ALTER ROLE unigate_app CONNECTION LIMIT 100;
-- Statement and idle-in-transaction ceilings: a stuck request cannot hold locks forever.
ALTER ROLE unigate_app SET statement_timeout = '30s';
ALTER ROLE unigate_app SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE unigate_app SET lock_timeout = '10s';

GRANT CONNECT ON DATABASE :"DBNAME" TO unigate_app;
GRANT USAGE ON SCHEMA public TO unigate_app;
-- Row access only; DDL stays with the owner. The constraints migration adds the per-table revokes.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO unigate_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO unigate_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO unigate_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO unigate_app;
-- Append-only tables (security.md §8.3): the broad GRANT above re-opens them, so the revokes are repeated
-- here — this script must stay safe to re-run. Partitions of audit_logs inherit through the parent.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs, audit_logs_default, ledger_entries, booking_financial_snapshots, payment_webhook_events FROM unigate_app;
SELECT format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM unigate_app', c.relname)
FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
WHERE p.relname = 'audit_logs'
\gexec

-- Nobody but the owner creates objects in public (closes the PostgreSQL < 15 public-schema default).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
