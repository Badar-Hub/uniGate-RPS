-- Runs once when the postgres volume is first created (docker-entrypoint-initdb.d).
-- Everything here must be idempotent-safe on a fresh cluster.

-- Extensions required by database.md §1. Created by the superuser so the
-- application role never needs CREATE EXTENSION rights at runtime.
CREATE EXTENSION IF NOT EXISTS "btree_gist";  -- vehicle calendar EXCLUDE constraint
CREATE EXTENSION IF NOT EXISTS "citext";      -- case-insensitive email
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- digest()/hmac()
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fuzzy search on plates/names
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Test database, same extensions.
CREATE DATABASE unigate_test OWNER unigate;
\connect unigate_test
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
\connect unigate

-- Runtime application role (security.md §8.3): the API connects as `unigate_app`
-- in staging/production, which holds INSERT+SELECT on audit_logs and NOT UPDATE/DELETE.
-- Locally the migrations run as `unigate` (owner); the grant script in the migration
-- folder applies the same policy to whichever role is named UNIGATE_APP_ROLE.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'unigate_app') THEN
    CREATE ROLE unigate_app LOGIN PASSWORD 'unigate_app';
  END IF;
END
$$;
GRANT CONNECT ON DATABASE unigate TO unigate_app;
