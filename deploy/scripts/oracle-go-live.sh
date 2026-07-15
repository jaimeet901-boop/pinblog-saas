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

echo "[1/8] Preflight checks"
command -v docker >/dev/null 2>&1 || { echo "ERROR: docker not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: docker compose plugin not installed"; exit 1; }

require_file "apps/api/.env"
require_file "$COMPOSE_FILE"

echo "[2/8] Pull latest images base layers"
docker compose -f "$COMPOSE_FILE" pull || true

echo "[3/8] Build and start services"
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[4/8] Wait for containers"
sleep 8

echo "[5/8] Show service status"
docker compose -f "$COMPOSE_FILE" ps

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
