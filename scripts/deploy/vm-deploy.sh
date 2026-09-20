#!/usr/bin/env bash
# Build and (re)start the single-host stack from the current checkout (docs/deployment.md).
#   scripts/deploy/vm-deploy.sh            build images, run migrations, start/refresh every service
#   scripts/deploy/vm-deploy.sh seed       additionally run the reference seed (idempotent; first deploy)
#   scripts/deploy/vm-deploy.sh status     health of every container
#   scripts/deploy/vm-deploy.sh logs api   follow one service
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.deploy)
[[ -f .env.deploy ]] || { echo "missing .env.deploy — copy .env.deploy.example and fill in the secrets" >&2; exit 1; }
export GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"

case "${1:-deploy}" in
  status) "${COMPOSE[@]}" ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}" ;;
  logs)   "${COMPOSE[@]}" logs -f --tail=200 "${2:-api}" ;;
  seed)
    "${COMPOSE[@]}" run --rm --no-deps api node_modules/.bin/tsx prisma/seed/index.ts ;;
  deploy)
    echo "== building images (GIT_SHA=$GIT_SHA)"
    "${COMPOSE[@]}" build --pull
    echo "== migrating and starting"
    "${COMPOSE[@]}" up -d --remove-orphans
    echo "== waiting for the API"
    for _ in $(seq 1 40); do
      if "${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | grep -q '^api healthy'; then break; fi
      sleep 3
    done
    "${COMPOSE[@]}" ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"
    docker image prune -f >/dev/null ;;
  *) echo "usage: $0 [deploy|seed|status|logs <service>]" >&2; exit 2 ;;
esac
