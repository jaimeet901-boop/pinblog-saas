#!/usr/bin/env bash
# Deploy ONLY the Compose `api` service (production).
#
# Guarantees (verified after deploy):
#   - web, pocketbase, nginx (Docker) container ID + image ID unchanged
#   - host nginx is never touched
#
# Usage (from repo root):
#   CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-api.sh
#   DRY_RUN=1 ./deploy/scripts/deploy-api.sh
#   ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-api.sh
#
# Does NOT push, commit, stash, reset, or deploy other services.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/deploy-common.sh
source "${SCRIPT_DIR}/lib/deploy-common.sh"

require_repo_root
require_production_confirm "api"
require_clean_worktree

GIT_SHA="$(resolve_git_sha)"
log "Git SHA=${GIT_SHA}"
log "Compose file=${COMPOSE_FILE}"
log "DRY_RUN=${DRY_RUN}"

BEFORE_API="$(snapshot_service api)"
BEFORE_WEB="$(snapshot_service web)"
BEFORE_PB="$(snapshot_service pocketbase)"
BEFORE_NGINX="$(snapshot_service nginx)"

IFS='|' read -r OLD_API_CID OLD_API_IMAGE_NAME OLD_API_IMAGE_ID <<<"${BEFORE_API}"

log "previous api: cid=${OLD_API_CID} image=${OLD_API_IMAGE_NAME} id=${OLD_API_IMAGE_ID}"
log "baseline web:       ${BEFORE_WEB}"
log "baseline pocketbase:${BEFORE_PB}"
log "baseline nginx:     ${BEFORE_NGINX}"

PREVIOUS_API_REF="${OLD_API_IMAGE_NAME}"
PREVIOUS_API_ID="${OLD_API_IMAGE_ID}"

build_service_image api "${GIT_SHA}"
retag_for_compose api "${GIT_SHA}"

SHA_REF="seodeva-api:${GIT_SHA}"
print_image_report "new api image (SHA tag)" "${SHA_REF}"

run_cmd docker compose -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate api

wait_for_healthy api

assert_service_unchanged web "${BEFORE_WEB}"
assert_service_unchanged pocketbase "${BEFORE_PB}"
assert_service_unchanged nginx "${BEFORE_NGINX}"

AFTER_API="$(snapshot_service api)"
IFS='|' read -r NEW_API_CID NEW_API_IMAGE_NAME NEW_API_IMAGE_ID <<<"${AFTER_API}"

# Existing compose nginx health path / API surface on localhost bind.
http_check "http://127.0.0.1:${APP_HTTP_PORT}/api/health"

echo
echo "======== API DEPLOY SUMMARY ========"
echo "Git SHA:              ${GIT_SHA}"
echo "Previous api image:   ${PREVIOUS_API_REF}"
echo "Previous api ID:      ${PREVIOUS_API_ID}"
echo "Previous api CID:     ${OLD_API_CID}"
echo "New api image:        ${NEW_API_IMAGE_NAME}"
echo "New api ID:           ${NEW_API_IMAGE_ID}"
echo "New api CID:          ${NEW_API_CID}"
echo "SHA tag:              ${SHA_REF}"
if [[ "${DRY_RUN}" != "1" ]]; then
	echo "SHA image digest/ID:  $(image_digest_or_id "${SHA_REF}")"
	echo "OCI revision label:   $(image_oci_revision "${SHA_REF}")"
fi
echo "Unchanged:            web, pocketbase, docker nginx"
echo "Not touched:          host nginx"
echo "===================================="
echo "Phase 4 note: keep Previous api ID (${PREVIOUS_API_ID}) for digest rollback."
