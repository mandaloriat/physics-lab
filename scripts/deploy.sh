#!/usr/bin/env bash
# Deploy or update the production lab on the server.
#
#   ./scripts/deploy.sh                # pull, build, restart, smoke-test
#   ./scripts/deploy.sh --no-pull      # rebuild the current checkout
#   ./scripts/deploy.sh --rollback     # go back to the previous commit
#
# Deliberately small. It runs the two commands the README documents by hand, then checks
# that the result works — because the failure worth catching is a deployment that comes
# up and serves a broken page, which `docker compose up -d` reports as success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PULL=1
ROLLBACK=0

for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    --rollback) ROLLBACK=1 ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f .env ]; then
  echo "no .env found. Copy .env.example to .env and set LAB_DOMAIN." >&2
  exit 1
fi

# shellcheck disable=SC1091
LAB_DOMAIN=$(grep -E '^LAB_DOMAIN=' .env | cut -d= -f2- | tr -d '"' || true)
LAB_DOMAIN="${LAB_DOMAIN:-lab.andolfatto.eu}"

# Which Caddy overlay this host uses. compose.production.yaml runs its own Caddy
# container on 80/443; compose.host-caddy.yaml instead publishes the api to
# 127.0.0.1 for a shared, host-level Caddy that already owns those ports (see that
# file's header). Boxes in the second group must set this in .env, or this script
# fights the host Caddy for port 80 every time it runs.
LAB_COMPOSE_OVERLAY=$(grep -E '^LAB_COMPOSE_OVERLAY=' .env | cut -d= -f2- | tr -d '"' || true)
LAB_COMPOSE_OVERLAY="${LAB_COMPOSE_OVERLAY:-compose.production.yaml}"
COMPOSE=(docker compose -f compose.yaml -f "$LAB_COMPOSE_OVERLAY")

PREVIOUS=$(git rev-parse HEAD)
echo "==> current revision: ${PREVIOUS:0:7}"

if [ "$ROLLBACK" -eq 1 ]; then
  echo "==> rolling back to the previous commit"
  git checkout HEAD~1
elif [ "$PULL" -eq 1 ]; then
  echo "==> fetching"
  git pull --ff-only
fi

# A pin that disagrees with itself builds a container whose widgets, server and adapters
# come from different commits. Cheaper to catch here than in production.
echo "==> checking the Fenix Spoon pin"
./scripts/check-pins.sh

echo "==> building"
"${COMPOSE[@]}" build

echo "==> starting"
"${COMPOSE[@]}" up -d --remove-orphans

echo "==> waiting for the API to become healthy"
for _ in $(seq 1 60); do
  state=$("${COMPOSE[@]}" ps --format json api 2>/dev/null \
          | python3 -c "import json,sys; print(json.loads(sys.stdin.readline() or '{}').get('Health',''))" \
          2>/dev/null || true)
  [ "$state" = "healthy" ] && break
  sleep 3
done

echo "==> smoke test"
if ./scripts/smoke-test.sh "https://${LAB_DOMAIN}"; then
  echo
  echo "deployed: https://${LAB_DOMAIN} (was ${PREVIOUS:0:7}, now $(git rev-parse --short HEAD))"
  echo "rollback with: ./scripts/deploy.sh --rollback"
else
  echo >&2
  echo "SMOKE TEST FAILED. The previous revision was ${PREVIOUS:0:7}." >&2
  echo "Roll back with:" >&2
  echo "  git checkout ${PREVIOUS}" >&2
  echo "  ${COMPOSE[*]} up -d --build" >&2
  exit 1
fi
