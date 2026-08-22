#!/usr/bin/env bash
# Rollback ONLY Compose `api` to an immutable previous image ID.
# Does NOT rebuild, does NOT use git, does NOT compose down, does NOT require a clean tree.
#
# Source priority:
#   1) PREVIOUS_IMAGE_ID
#   2) deploy/state/last-api-deploy.json → previous_image_id
#   3) seodeva-api:previous
#
# Usage:
#   CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-api.sh
#   PREVIOUS_IMAGE_ID=sha256:… CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-api.sh
#   DRY_RUN=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-api.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/deploy-common.sh
source "${SCRIPT_DIR}/lib/deploy-common.sh"

require_repo_root
require_production_confirm "api" "rollback"
# Intentionally NO require_clean_worktree.

log "DRY_RUN=${DRY_RUN}"
log "Compose file=${COMPOSE_FILE}"

resolved="$(resolve_previous_image_id api)" || die "cannot resolve previous api image (set PREVIOUS_IMAGE_ID, or ensure state file / seodeva-api:previous exists)"
IMAGE_ID="${resolved%%|*}"
SOURCE_LABEL="${resolved#*|}"

log "resolved previous image: ${IMAGE_ID}"
log "rollback source: ${SOURCE_LABEL}"

if [[ "${SOURCE_LABEL}" == *pinblog-saas-api:latest* ]] || [[ "${IMAGE_ID}" == "pinblog-saas-api:latest" ]]; then
	die "refusing to use pinblog-saas-api:latest as rollback source"
fi

if [[ "${DRY_RUN}" != "1" ]]; then
	verify_image_id_exists "${IMAGE_ID}" || die "previous image not found locally: ${IMAGE_ID}"
fi

BEFORE_WEB="$(snapshot_service web)"
BEFORE_PB="$(snapshot_service pocketbase)"
BEFORE_NGINX="$(snapshot_service nginx)"

if [[ "${DRY_RUN}" == "1" ]]; then
	log "DRY_RUN: would retag ${IMAGE_ID} → pinblog-saas-api / :latest"
	log "DRY_RUN: docker compose -f ${COMPOSE_FILE} up -d --no-deps --force-recreate api"
	log "DRY_RUN: wait_for_healthy api"
	log "DRY_RUN: HTTP check http://127.0.0.1:${APP_HTTP_PORT}/api/health"
	log "DRY_RUN: assert peers unchanged web/pocketbase/nginx"
	echo "======== API ROLLBACK DRY-RUN ========"
	echo "Would restore image ID: ${IMAGE_ID}"
	echo "Rollback source:        ${SOURCE_LABEL}"
	echo "Compose command:        docker compose -f ${COMPOSE_FILE} up -d --no-deps --force-recreate api"
	echo "======================================"
	exit 0
fi

perform_rollback_to_image_id api "${IMAGE_ID}" "${SOURCE_LABEL}" \
	"web=${BEFORE_WEB}" "pocketbase=${BEFORE_PB}" "nginx=${BEFORE_NGINX}"
