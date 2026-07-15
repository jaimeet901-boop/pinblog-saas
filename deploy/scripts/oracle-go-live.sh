#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   DOMAIN=your-domain.com bash deploy/scripts/oracle-go-live.sh
# Optional:
#   COMPOSE_FILE=docker-compose.prod.yml

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DOMAIN="${DOMAIN:-}"

if [[ -z "${DOMAIN}" ]]; then
  echo "ERROR: DOMAIN is required. Example: DOMAIN=example.com bash deploy/scripts/oracle-go-live.sh"
  exit 1
fi

require_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    echo "ERROR: Missing required file: $path"
    exit 1
  fi
}

wait_for_healthy() {
  local service="$1"
  local max_wait_seconds="${2:-180}"
  local elapsed=0

  while (( elapsed < max_wait_seconds )); do
    local cid
    cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
    if [[ -z "$cid" ]]; then
      sleep 2
      elapsed=$((elapsed + 2))
      continue
    fi

    local status
    status="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
    if [[ "$status" != "running" ]]; then
      sleep 2
      elapsed=$((elapsed + 2))
      continue
    fi

    local health
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo unknown)"
    if [[ "$health" == "healthy" || "$health" == "none" ]]; then
      return 0
    fi

    if [[ "$health" == "unhealthy" ]]; then
      echo "ERROR: service '$service' became unhealthy"
      return 1
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "ERROR: timed out waiting for service '$service' to become healthy"
  return 1
}

assert_no_restarts() {
  local service="$1"
  local cid
  cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
  if [[ -z "$cid" ]]; then
    echo "ERROR: could not find container for service '$service'"
    return 1
  fi

  local restart_count
  restart_count="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 9999)"
  if [[ "$restart_count" != "0" ]]; then
    echo "ERROR: service '$service' restart count is $restart_count (expected 0)"
    return 1
  fi

  return 0
}

echo "[1/8] Preflight checks"
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose plugin not installed"; exit 1; }

require_file "apps/api/.env"
require_file "$COMPOSE_FILE"

echo "[2/8] Pull latest images base layers"
docker compose -f "$COMPOSE_FILE" pull || true

echo "[3/8] Build and start services"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[4/8] Wait for containers to become healthy"
for service in pocketbase api web nginx; do
  wait_for_healthy "$service" 240
done

echo "[5/8] Verify services are running without restarts"
docker compose -f "$COMPOSE_FILE" ps
for service in pocketbase api web nginx; do
  assert_no_restarts "$service"
done

echo "[6/8] Health check endpoint"
HEALTH_URL="https://${DOMAIN}/api/health"
if command -v curl >/dev/null 2>&1; then
  curl -ksS "$HEALTH_URL" | sed -n '1,120p'
else
  echo "WARN: curl not found; skipping direct health response output"
fi

echo "[7/8] Run smoke check script"
if [[ -f "deploy/scripts/health-smoke.sh" ]]; then
  bash deploy/scripts/health-smoke.sh "https://${DOMAIN}"
else
  echo "WARN: deploy/scripts/health-smoke.sh not found"
fi

echo "[8/8] Tail API logs (last 120 lines)"
docker compose -f "$COMPOSE_FILE" logs --tail=120 api || true

echo "Go-live deployment completed."
