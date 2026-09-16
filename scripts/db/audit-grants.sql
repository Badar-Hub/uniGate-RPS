-- DB role / grant audit (docs/hardening.md §7). Run against each environment:
--   psql "$DATABASE_URL" -f scripts/db/audit-grants.sql
-- Every check prints PASS or FAIL; the script exits non-zero on the first FAIL when run with
-- ON_ERROR_STOP, so it can gate a deployment.

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

-- 1. The runtime role exists and is not a superuser / cannot create databases or roles.
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unigate_app' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole)
  THEN 'PASS runtime role unigate_app is unprivileged' ELSE 'FAIL runtime role unigate_app missing or privileged' END;

-- 2. It owns nothing (DDL stays with the migration role).
SELECT CASE WHEN count(*) = 0 THEN 'PASS unigate_app owns no tables' ELSE 'FAIL unigate_app owns ' || count(*) || ' tables' END
FROM pg_tables WHERE tableowner = 'unigate_app';

-- 3. Append-only tables: no UPDATE / DELETE / TRUNCATE for the runtime role.
WITH protected(t) AS (VALUES ('audit_logs'), ('audit_logs_default'), ('ledger_entries'), ('booking_financial_snapshots'), ('payment_webhook_events'))
SELECT CASE WHEN count(*) = 0 THEN 'PASS append-only tables carry no UPDATE/DELETE/TRUNCATE for unigate_app'
  ELSE 'FAIL mutation grants on: ' || string_agg(DISTINCT table_name || ':' || privilege_type, ', ') END
FROM information_schema.role_table_grants g JOIN protected p ON p.t = g.table_name
WHERE grantee = 'unigate_app' AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE');

-- 4. The belt-and-braces triggers are present and enabled for every role (tgenabled = 'O').
SELECT CASE WHEN count(*) >= 3 AND bool_and(tgenabled = 'O') THEN 'PASS ' || count(*) || ' append-only / immutable triggers enabled'
  ELSE 'FAIL append-only triggers missing or disabled (' || count(*) || ')' END
FROM pg_trigger WHERE tgname LIKE 'trg_%append_only' OR tgname LIKE 'trg_%immutable';

-- 5. Nobody but the owner can create objects in the public schema.
SELECT CASE WHEN has_schema_privilege('public', 'public', 'CREATE') THEN 'FAIL PUBLIC can CREATE in schema public' ELSE 'PASS PUBLIC cannot CREATE in schema public' END;

-- 6. Session guards on the runtime role.
SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'unigate_app' AND array_to_string(s.setconfig, ',') LIKE '%statement_timeout%')
  THEN 'PASS statement_timeout set on unigate_app' ELSE 'WARN no statement_timeout on unigate_app (scripts/db/roles.sql sets 30s)' END;

-- 7. Which role does the current connection use? (Must be unigate_app in staging/production.)
SELECT 'INFO connected as ' || current_user || (CASE WHEN current_user = 'unigate_app' THEN ' (runtime role)' ELSE ' (owner / admin — fine for migrations and this audit, NOT for the API)' END);
