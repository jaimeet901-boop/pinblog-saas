#!/usr/bin/env bash
# Deploy ONLY the Compose `web` service (production). Phase 3 + Phase 4 state/rollback hooks.
#
# Guarantees (verified after deploy):
#   - api, pocketbase, nginx (Docker) container ID + image ID unchanged
#   - host nginx is never touched
#
# On failure (default): preserve state + print rollback command (no auto-rollback).
# Opt-in: AUTO_ROLLBACK=1 rolls back using recorded previous image ID only.
#
# Usage:
#   CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
#   DRY_RUN=1 ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh
#   AUTO_ROLLBACK=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-web.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/deploy-common.sh
source "${SCRIPT_DIR}/lib/deploy-common.sh"

require_repo_root
require_production_confirm "web" "deploy"
require_clean_worktree

GIT_SHA="$(resolve_git_sha)"
log "Git SHA=${GIT_SHA}"
log "Compose file=${COMPOSE_FILE}"
log "DRY_RUN=${DRY_RUN}"
log "AUTO_ROLLBACK=${AUTO_ROLLBACK}"

BEFORE_WEB="$(snapshot_service web)"
BEFORE_API="$(snapshot_service api)"
BEFORE_PB="$(snapshot_service pocketbase)"
BEFORE_NGINX="$(snapshot_service nginx)"

IFS='|' read -r OLD_WEB_CID OLD_WEB_IMAGE_NAME OLD_WEB_IMAGE_ID <<<"${BEFORE_WEB}"

log "previous web: cid=${OLD_WEB_CID} image=${OLD_WEB_IMAGE_NAME} id=${OLD_WEB_IMAGE_ID}"
log "baseline api:       ${BEFORE_API}"
log "baseline pocketbase:${BEFORE_PB}"
log "baseline nginx:     ${BEFORE_NGINX}"

PREVIOUS_WEB_REF="${OLD_WEB_IMAGE_NAME}"
PREVIOUS_WEB_ID="${OLD_WEB_IMAGE_ID}"
PREVIOUS_OCI="$(image_oci_revision "${PREVIOUS_WEB_ID}" 2>/dev/null || true)"

# Pending state BEFORE mutate (retain previous ID for recovery).
atomic_write_deploy_state web \
	"status=pending" \
	"recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	"git_sha_deployed=${GIT_SHA}" \
	"previous_image_id=${PREVIOUS_WEB_ID}" \
	"previous_image_name=${PREVIOUS_WEB_REF}" \
	"previous_container_id=${OLD_WEB_CID}" \
	"previous_oci_revision=${PREVIOUS_OCI}" \
	"new_sha_tag=seodeva-web:${GIT_SHA}" \
	"peer_api=${BEFORE_API}" \
	"peer_pocketbase=${BEFORE_PB}" \
	"peer_nginx=${BEFORE_NGINX}"

# Retention tag MUST point at previous image BEFORE Compose retag.
tag_previous_retention web "${PREVIOUS_WEB_ID}" || warn "retention tag skipped (no previous image)"

build_service_image web "${GIT_SHA}"
retag_for_compose web "${GIT_SHA}"

SHA_REF="seodeva-web:${GIT_SHA}"
print_image_report "new web image (SHA tag)" "${SHA_REF}"

run_cmd docker compose -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate web

# Soft validation so we can preserve state / optional AUTO_ROLLBACK.
fail_reason=""
if ! wait_for_healthy_soft web; then
	fail_reason="web_unhealthy"
elif ! http_check_soft "http://127.0.0.1:${APP_HTTP_PORT}/"; then
	fail_reason="web_http_failed"
elif ! assert_service_unchanged_soft api "${BEFORE_API}"; then
	fail_reason="peer_api_changed"
elif ! assert_service_unchanged_soft pocketbase "${BEFORE_PB}"; then
	fail_reason="peer_pocketbase_changed"
elif ! assert_service_unchanged_soft nginx "${BEFORE_NGINX}"; then
	fail_reason="peer_nginx_changed"
fi

if [[ -n "${fail_reason}" ]]; then
	handle_deploy_failure web "${fail_reason}" "${PREVIOUS_WEB_ID}" "${GIT_SHA}" \
		"${BEFORE_WEB}" "${BEFORE_API}" "${BEFORE_PB}" "${BEFORE_NGINX}"
fi

AFTER_WEB="$(snapshot_service web)"
IFS='|' read -r NEW_WEB_CID NEW_WEB_IMAGE_NAME NEW_WEB_IMAGE_ID <<<"${AFTER_WEB}"

NEW_ID="${NEW_WEB_IMAGE_ID}"
if [[ "${DRY_RUN}" != "1" ]] && docker image inspect "${SHA_REF}" >/dev/null 2>&1; then
	NEW_ID="$(docker image inspect "${SHA_REF}" --format '{{.Id}}')"
fi

# Success: update state (retain previous_image_id for next rollback).
atomic_write_deploy_state web \
	"status=success" \
	"recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	"git_sha_deployed=${GIT_SHA}" \
	"previous_image_id=${PREVIOUS_WEB_ID}" \
	"previous_image_name=${PREVIOUS_WEB_REF}" \
	"previous_container_id=${OLD_WEB_CID}" \
	"previous_oci_revision=${PREVIOUS_OCI}" \
	"new_image_id=${NEW_ID}" \
	"new_sha_tag=${SHA_REF}" \
	"new_container_id=${NEW_WEB_CID}" \
	"failure_reason=" \
	"peer_api=${BEFORE_API}" \
	"peer_pocketbase=${BEFORE_PB}" \
	"peer_nginx=${BEFORE_NGINX}"

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
echo "State file:           $(state_file_for web)"
echo "Retention tag:        $(previous_retention_tag web)"
if [[ "${DRY_RUN}" != "1" ]]; then
	echo "SHA image digest/ID:  $(image_digest_or_id "${SHA_REF}")"
	echo "OCI revision label:   $(image_oci_revision "${SHA_REF}")"
fi
echo "Unchanged:            api, pocketbase, docker nginx"
echo "Not touched:          host nginx"
echo "===================================="
