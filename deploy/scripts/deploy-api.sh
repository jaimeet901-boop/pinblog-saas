#!/usr/bin/env bash
# Deploy ONLY the Compose `api` service (production). Phase 3 + Phase 4 state/rollback hooks.
#
# On failure (default): preserve state + print rollback command (no auto-rollback).
# Opt-in: AUTO_ROLLBACK=1 rolls back using recorded previous image ID only.
#
# Usage:
#   CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-api.sh
#   DRY_RUN=1 ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-api.sh
#   AUTO_ROLLBACK=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/deploy-api.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/deploy-common.sh
source "${SCRIPT_DIR}/lib/deploy-common.sh"

require_repo_root
require_production_confirm "api" "deploy"
require_clean_worktree

GIT_SHA="$(resolve_git_sha)"
log "Git SHA=${GIT_SHA}"
log "Compose file=${COMPOSE_FILE}"
log "DRY_RUN=${DRY_RUN}"
log "AUTO_ROLLBACK=${AUTO_ROLLBACK}"

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
PREVIOUS_OCI="$(image_oci_revision "${PREVIOUS_API_ID}" 2>/dev/null || true)"

atomic_write_deploy_state api \
	"status=pending" \
	"recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	"git_sha_deployed=${GIT_SHA}" \
	"previous_image_id=${PREVIOUS_API_ID}" \
	"previous_image_name=${PREVIOUS_API_REF}" \
	"previous_container_id=${OLD_API_CID}" \
	"previous_oci_revision=${PREVIOUS_OCI}" \
	"new_sha_tag=seodeva-api:${GIT_SHA}" \
	"peer_web=${BEFORE_WEB}" \
	"peer_pocketbase=${BEFORE_PB}" \
	"peer_nginx=${BEFORE_NGINX}"

tag_previous_retention api "${PREVIOUS_API_ID}" || warn "retention tag skipped (no previous image)"

build_service_image api "${GIT_SHA}"
retag_for_compose api "${GIT_SHA}"

SHA_REF="seodeva-api:${GIT_SHA}"
print_image_report "new api image (SHA tag)" "${SHA_REF}"

run_cmd docker compose -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate api

fail_reason=""
if ! wait_for_healthy_soft api; then
	fail_reason="api_unhealthy"
elif ! http_check_soft "http://127.0.0.1:${APP_HTTP_PORT}/api/health"; then
	fail_reason="api_http_failed"
elif ! assert_service_unchanged_soft web "${BEFORE_WEB}"; then
	fail_reason="peer_web_changed"
elif ! assert_service_unchanged_soft pocketbase "${BEFORE_PB}"; then
	fail_reason="peer_pocketbase_changed"
elif ! assert_service_unchanged_soft nginx "${BEFORE_NGINX}"; then
	fail_reason="peer_nginx_changed"
fi

if [[ -n "${fail_reason}" ]]; then
	handle_deploy_failure api "${fail_reason}" "${PREVIOUS_API_ID}" "${GIT_SHA}" \
		"${BEFORE_WEB}" "${BEFORE_API}" "${BEFORE_PB}" "${BEFORE_NGINX}"
fi

AFTER_API="$(snapshot_service api)"
IFS='|' read -r NEW_API_CID NEW_API_IMAGE_NAME NEW_API_IMAGE_ID <<<"${AFTER_API}"

NEW_ID="${NEW_API_IMAGE_ID}"
if [[ "${DRY_RUN}" != "1" ]] && docker image inspect "${SHA_REF}" >/dev/null 2>&1; then
	NEW_ID="$(docker image inspect "${SHA_REF}" --format '{{.Id}}')"
fi

atomic_write_deploy_state api \
	"status=success" \
	"recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
	"git_sha_deployed=${GIT_SHA}" \
	"previous_image_id=${PREVIOUS_API_ID}" \
	"previous_image_name=${PREVIOUS_API_REF}" \
	"previous_container_id=${OLD_API_CID}" \
	"previous_oci_revision=${PREVIOUS_OCI}" \
	"new_image_id=${NEW_ID}" \
	"new_sha_tag=${SHA_REF}" \
	"new_container_id=${NEW_API_CID}" \
	"failure_reason=" \
	"peer_web=${BEFORE_WEB}" \
	"peer_pocketbase=${BEFORE_PB}" \
	"peer_nginx=${BEFORE_NGINX}"

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
echo "State file:           $(state_file_for api)"
echo "Retention tag:        $(previous_retention_tag api)"
if [[ "${DRY_RUN}" != "1" ]]; then
	echo "SHA image digest/ID:  $(image_digest_or_id "${SHA_REF}")"
	echo "OCI revision label:   $(image_oci_revision "${SHA_REF}")"
fi
echo "Unchanged:            web, pocketbase, docker nginx"
echo "Not touched:          host nginx"
echo "===================================="
