#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-https://localhost}"
HEALTH_URL="${BASE_URL%/}/api/health"

echo "Checking ${HEALTH_URL}"
RESPONSE=$(curl -fsS "${HEALTH_URL}")
echo "${RESPONSE}" | grep -q '"status"' || { echo "Missing status field"; exit 1; }
echo "${RESPONSE}" | grep -q '"services"' || { echo "Missing services field"; exit 1; }
echo "Health smoke check passed"
