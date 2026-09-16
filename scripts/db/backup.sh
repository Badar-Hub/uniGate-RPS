#!/usr/bin/env bash
# Logical backup of the UniGate database (docs/hardening.md §6 — backup / restore drill).
#
#   scripts/db/backup.sh                       # dev: dumps through the docker-compose postgres container
#   DATABASE_URL=postgres://… scripts/db/backup.sh   # anywhere pg_dump can reach the server
#
# Writes backups/unigate-<db>-<UTC timestamp>.dump (pg_dump custom format, compressed, restorable
# with pg_restore in any table order). Custom format is chosen over plain SQL because the schema
# carries partitions, exclusion constraints and append-only triggers whose creation order matters.
# Production backups are the platform's managed snapshots (Phase 16); this script is the portable
# logical copy used for the drill, migrations rehearsals and moving data between environments.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="${BACKUP_DIR:-$ROOT/backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

if [[ -n "${DATABASE_URL:-}" ]]; then
  DB_NAME="$(echo "$DATABASE_URL" | sed -E 's#.*/([^/?]+)(\?.*)?$#\1#')"
  FILE="$OUT_DIR/unigate-$DB_NAME-$STAMP.dump"
  pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$FILE" "$DATABASE_URL"
else
  CONTAINER="$(docker ps --filter name=postgres --format '{{.Names}}' | head -n1)"
  [[ -n "$CONTAINER" ]] || { echo "no postgres container running and DATABASE_URL not set" >&2; exit 1; }
  DB_NAME="${PGDATABASE:-unigate}"
  FILE="$OUT_DIR/unigate-$DB_NAME-$STAMP.dump"
  docker exec "$CONTAINER" pg_dump -U unigate --format=custom --compress=6 --no-owner --no-privileges "$DB_NAME" > "$FILE"
fi

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
SHA="$(sha256sum "$FILE" | cut -d' ' -f1)"
echo "$SHA  $(basename "$FILE")" >> "$OUT_DIR/SHA256SUMS"
echo "backup written: $FILE ($SIZE bytes, sha256 $SHA)"
