#!/usr/bin/env bash
# Restore a backup taken by scripts/db/backup.sh into a NEW database and verify it.
#
#   scripts/db/restore.sh backups/unigate-unigate-20260916T120000Z.dump            # → database unigate_restore
#   scripts/db/restore.sh backups/….dump unigate_drill                              # → named database
#   DATABASE_URL=postgres://…/postgres scripts/db/restore.sh ….dump unigate_drill   # remote server (needs CREATEDB)
#
# Never restores over an existing database: the target must not exist, so a drill cannot clobber
# the live one. Prints the row counts of the largest tables and the migration ledger so the result
# can be compared with the source (docs/hardening.md §6). The append-only triggers are recreated by
# the dump, so a restored copy is as tamper-evident as the original.
set -euo pipefail

FILE="${1:?usage: restore.sh <dump-file> [target-db]}"
TARGET="${2:-unigate_restore}"
[[ -f "$FILE" ]] || { echo "no such file: $FILE" >&2; exit 1; }
[[ "$TARGET" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "invalid database name: $TARGET" >&2; exit 1; }

if [[ -n "${DATABASE_URL:-}" ]]; then
  ADMIN_URL="$DATABASE_URL"
  psql_admin() { psql -v ON_ERROR_STOP=1 -qtA "$ADMIN_URL" "$@"; }
  restore_into() { pg_restore --no-owner --no-privileges --exit-on-error --dbname="$(echo "$ADMIN_URL" | sed -E "s#/[^/?]+(\?.*)?\$#/$TARGET\1#")" "$FILE"; }
  psql_target() { psql -v ON_ERROR_STOP=1 -qtA "$(echo "$ADMIN_URL" | sed -E "s#/[^/?]+(\?.*)?\$#/$TARGET\1#")" "$@"; }
else
  CONTAINER="$(docker ps --filter name=postgres --format '{{.Names}}' | head -n1)"
  [[ -n "$CONTAINER" ]] || { echo "no postgres container running and DATABASE_URL not set" >&2; exit 1; }
  psql_admin() { docker exec -i "$CONTAINER" psql -U unigate -d postgres -v ON_ERROR_STOP=1 -qtA "$@"; }
  restore_into() { docker exec -i "$CONTAINER" pg_restore -U unigate --no-owner --no-privileges --exit-on-error --dbname="$TARGET" < "$FILE"; }
  psql_target() { docker exec -i "$CONTAINER" psql -U unigate -d "$TARGET" -v ON_ERROR_STOP=1 -qtA "$@"; }
fi

if [[ "$(psql_admin -c "SELECT 1 FROM pg_database WHERE datname = '$TARGET'")" == "1" ]]; then
  echo "refusing to restore: database '$TARGET' already exists (drop it first if this is intended)" >&2
  exit 2
fi

echo "creating $TARGET …"
psql_admin -c "CREATE DATABASE \"$TARGET\""
echo "restoring $(basename "$FILE") …"
START=$(date +%s)
restore_into
echo "restored in $(( $(date +%s) - START ))s"

echo "── verification ──"
psql_target -c "SELECT 'migrations applied: ' || count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL"
psql_target -c "SELECT 'append-only triggers: ' || count(*) FROM pg_trigger WHERE tgname LIKE 'trg_%append_only' OR tgname LIKE 'trg_%immutable'"
psql_target -c "SELECT rpad(relname, 36) || n_live_tup FROM pg_stat_user_tables WHERE n_live_tup > 0 ORDER BY n_live_tup DESC LIMIT 15"
echo "drop the copy when done:  DROP DATABASE \"$TARGET\";"
