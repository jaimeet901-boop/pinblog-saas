#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   bash deploy/scripts/oracle-rollback.sh
# Optional:
#   COMPOSE_FILE=docker-compose.prod.yml

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

echo "[1/4] Stopping current stack"
docker compose -f "$COMPOSE_FILE" down

echo "[2/4] Starting previous known-good stack definition"
# This assumes you already checked out / deployed a previous known-good commit or image tags.
docker compose -f "$COMPOSE_FILE" up -d --build

echo "[3/4] Current service status"
docker compose -f "$COMPOSE_FILE" ps

echo "[4/4] Last API logs"
docker compose -f "$COMPOSE_FILE" logs --tail=120 api || true

echo "Rollback procedure completed. Verify https://YOUR_DOMAIN/api/health"
