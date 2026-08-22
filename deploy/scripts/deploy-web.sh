#!/usr/bin/env bash
# Deploy ONLY the Compose `web` service (production).
#
# Guarantees (verified after deploy):
#   - api, pocketbase, nginx (Docker) container ID + image ID unchanged
#   - host nginx is never touched
#
# Usage (from repo root):
#   CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
#   DRY_RUN=1 ./deploy/scripts/deploy-web.sh
#   ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
#
# Does NOT push, commit, stash, reset, or deploy other services.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/deploy-common.sh
source "${SCRIPT_DIR}/lib/deploy-common.sh"

require_repo_root
require_production_confirm "web"
require_clean_worktree

GIT_SHA="$(resolve_git_sha)"
log "Git SHA=${GIT_SHA}"
log "Compose file=${COMPOSE_FILE}"
log "DRY_RUN=${DRY_RUN}"

# Snapshots BEFORE any mutate (isolation baseline).
BEFORE_WEB="$(snapshot_service web)"
BEFORE_API="$(snapshot_service api)"
BEFORE_PB="$(snapshot_service pocketbase)"
BEFORE_NGINX="$(snapshot_service nginx)"

IFS='|' read -r OLD_WEB_CID OLD_WEB_IMAGE_NAME OLD_WEB_IMAGE_ID <<<"${BEFORE_WEB}"

log "previous web: cid=${OLD_WEB_CID} image=${OLD_WEB_IMAGE_NAME} id=${OLD_WEB_IMAGE_ID}"
log "baseline api:       ${BEFORE_API}"
log "baseline pocketbase:${BEFORE_PB}"
log "baseline nginx:     ${BEFORE_NGINX}"

# Preserve previous image reference for Phase 4 rollback (report only).
PREVIOUS_WEB_REF="${OLD_WEB_IMAGE_NAME}"
PREVIOUS_WEB_ID="${OLD_WEB_IMAGE_ID}"

build_service_image web "${GIT_SHA}"
retag_for_compose web "${GIT_SHA}"

SHA_REF="seodeva-web:${GIT_SHA}"
print_image_report "new web image (SHA tag)" "${SHA_REF}"

# Recreate ONLY web — never --build here (image already built + retagged).
# --no-deps prevents starting/recreating api/pocketbase/nginx.
run_cmd docker compose -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate web

wait_for_healthy web

# Isolation: peer services must be byte-identical snapshots.
assert_service_unchanged api "${BEFORE_API}"
assert_service_unchanged pocketbase "${BEFORE_PB}"
assert_service_unchanged nginx "${BEFORE_NGINX}"

AFTER_WEB="$(snapshot_service web)"
IFS='|' read -r NEW_WEB_CID NEW_WEB_IMAGE_NAME NEW_WEB_IMAGE_ID <<<"${AFTER_WEB}"

# HTTP via Docker nginx localhost bind (does not touch host nginx).
http_check "http://127.0.0.1:${APP_HTTP_PORT}/"

echo
echo "======== WEB DEPLOY SUMMARY ========"
echo "Git SHA:              ${GIT_SHA}"
echo "Previous web image:   ${PREVIOUS_WEB_REF}"
echo "Previous web ID:      ${PREVIOUS_WEB_ID}"
echo "Previous web CID:     ${OLD_WEB_CID}"
echo "New web image:        ${NEW_WEB_IMAGE_NAME}"
echo "New web ID:           ${NEW_WEB_IMAGE_ID}"
echo "New web CID:          ${NEW_WEB_CID}"
echo "SHA tag:              ${SHA_REF}"
if [[ "${DRY_RUN}" != "1" ]]; then
	echo "SHA image digest/ID:  $(image_digest_or_id "${SHA_REF}")"
	echo "OCI revision label:   $(image_oci_revision "${SHA_REF}")"
fi
echo "Unchanged:            api, pocketbase, docker nginx"
echo "Not touched:          host nginx"
echo "===================================="
echo "Phase 4 note: keep Previous web ID (${PREVIOUS_WEB_ID}) for digest rollback."
