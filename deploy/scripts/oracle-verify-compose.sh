#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   DOMAIN=your-domain.com bash deploy/scripts/oracle-verify-compose.sh
# Optional:
#   COMPOSE_FILE=docker-compose.prod.yml
#   APP_HTTP_PORT=8080

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DOMAIN="${DOMAIN:-}"
LOCAL_PORT="${APP_HTTP_PORT:-8080}"

if [[ -z "${DOMAIN}" ]]; then
  echo "ERROR: DOMAIN is required. Example: DOMAIN=example.com bash deploy/scripts/oracle-verify-compose.sh"
  exit 1
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: Missing required command '$1'"
    exit 1
  }
}

wait_for_service_healthy() {
  local service="$1"
  local timeout_seconds="${2:-240}"
  local elapsed=0

  while (( elapsed < timeout_seconds )); do
    local cid
    cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
    if [[ -z "$cid" ]]; then
      sleep 2
      elapsed=$((elapsed + 2))
      continue
    fi

    local state
    state="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
    local health
    health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo unknown)"

    if [[ "$state" == "running" && ( "$health" == "healthy" || "$health" == "none" ) ]]; then
      return 0
    fi

    if [[ "$state" == "exited" || "$health" == "unhealthy" ]]; then
      echo "ERROR: service '$service' is state=$state health=$health"
      docker compose -f "$COMPOSE_FILE" logs --tail=120 "$service" || true
      return 1
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "ERROR: timed out waiting for '$service' to become healthy"
  docker compose -f "$COMPOSE_FILE" logs --tail=120 "$service" || true
  return 1
}

assert_restart_count_zero() {
  local service="$1"
  local cid
  cid="$(docker compose -f "$COMPOSE_FILE" ps -q "$service")"
  if [[ -z "$cid" ]]; then
    echo "ERROR: no container ID found for '$service'"
    return 1
  fi

  local restart_count
  restart_count="$(docker inspect -f '{{.RestartCount}}' "$cid" 2>/dev/null || echo 9999)"
  echo "INFO: $service restart_count=$restart_count"
  [[ "$restart_count" == "0" ]]
}

echo "[1/8] Preflight"
require_command docker
require_command curl
[[ -f "$COMPOSE_FILE" ]] || { echo "ERROR: Missing compose file $COMPOSE_FILE"; exit 1; }
[[ -f "apps/api/.env" ]] || { echo "ERROR: Missing apps/api/.env"; exit 1; }

echo "[2/8] Build"
docker compose -f "$COMPOSE_FILE" build

echo "[3/8] Start stack"
docker compose -f "$COMPOSE_FILE" up -d

echo "[4/8] Wait for core services"
for service in pocketbase api web nginx; do
  wait_for_service_healthy "$service" 300
done

echo "[5/8] Confirm all services are running"
docker compose -f "$COMPOSE_FILE" ps

echo "[6/8] Ensure no service is restarting"
for service in pocketbase api web nginx; do
  assert_restart_count_zero "$service" || {
    echo "ERROR: service '$service' has restart_count > 0"
    exit 1
  }
done

echo "[7/8] Validate internal/local route"
curl -fsS "http://127.0.0.1:${LOCAL_PORT}/api/health" | sed -n '1,120p'

echo "[8/8] Validate public CloudPanel route"
curl -fsS "https://${DOMAIN}/api/health" | sed -n '1,120p'

echo "Verification passed: compose build/up succeeded and all containers are stable."