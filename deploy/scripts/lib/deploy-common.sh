#!/usr/bin/env bash
# Shared helpers for service-scoped production deploys (Phase 3).
# Sourced by deploy-web.sh / deploy-api.sh — not meant to be run directly.

set -euo pipefail

DEPLOY_COMMON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
APP_HTTP_PORT="${APP_HTTP_PORT:-18080}"
DRY_RUN="${DRY_RUN:-0}"
ALLOW_DIRTY_WORKTREE="${ALLOW_DIRTY_WORKTREE:-0}"
CONFIRM_PRODUCTION="${CONFIRM_PRODUCTION:-}"
HEALTH_WAIT_SECONDS="${HEALTH_WAIT_SECONDS:-180}"

die() {
	echo "ERROR: $*" >&2
	exit 1
}

log() {
	echo "[deploy] $*"
}

warn() {
	echo "WARNING: $*" >&2
}

require_repo_root() {
	cd "$DEPLOY_COMMON_ROOT"
	[[ -f "$COMPOSE_FILE" ]] || die "missing compose file: $COMPOSE_FILE (cwd=$PWD)"
	[[ -f Dockerfile.api && -f Dockerfile.web ]] || die "missing Dockerfiles at repo root"
	[[ -x deploy/scripts/build-images-with-sha.sh ]] || die "missing executable deploy/scripts/build-images-with-sha.sh"
}

require_production_confirm() {
	local service="$1"
	if [[ "${CONFIRM_PRODUCTION}" == "YES" ]]; then
		log "CONFIRM_PRODUCTION=YES accepted for ${service} deploy"
		return 0
	fi
	echo
	echo "================================================================="
	echo " PRODUCTION DEPLOY — service: ${service}"
	echo " This will recreate ONLY the '${service}' Compose service."
	echo " Other services must remain unchanged (verified after deploy)."
	echo "================================================================="
	echo
	read -r -p "Type PRODUCTION to continue (anything else aborts): " answer
	[[ "${answer}" == "PRODUCTION" ]] || die "aborted (confirmation not PRODUCTION)"
}

require_clean_worktree() {
	local dirty
	dirty="$(git status --porcelain 2>/dev/null || true)"
	if [[ -z "${dirty}" ]]; then
		log "working tree clean"
		return 0
	fi
	if [[ "${ALLOW_DIRTY_WORKTREE}" == "1" ]]; then
		warn "ALLOW_DIRTY_WORKTREE=1 — deploying with a DIRTY worktree"
		warn "Git SHA still used for tags/labels: $(git rev-parse HEAD)"
		echo "----- git status --porcelain -----"
		echo "${dirty}"
		echo "----------------------------------"
		return 0
	fi
	echo "ERROR: working tree is dirty; refusing to deploy arbitrary uncommitted changes." >&2
	echo "Commit/stash your work, or set ALLOW_DIRTY_WORKTREE=1 to override (prints a warning)." >&2
	echo "----- git status --porcelain -----" >&2
	echo "${dirty}" >&2
	echo "----------------------------------" >&2
	return 1
}

resolve_git_sha() {
	git rev-parse HEAD
}

run_cmd() {
	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: $*"
		return 0
	fi
	log "+ $*"
	"$@"
}

compose() {
	docker compose -f "$COMPOSE_FILE" "$@"
}

service_cid() {
	local service="$1"
	compose ps -q "$service" 2>/dev/null || true
}

# Prints: cid|image_name|image_id
snapshot_service() {
	local service="$1"
	local cid image_name image_id
	cid="$(service_cid "$service")"
	if [[ -z "${cid}" ]]; then
		echo "missing|missing|missing"
		return 0
	fi
	image_name="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || echo missing)"
	image_id="$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null || echo missing)"
	echo "${cid}|${image_name}|${image_id}"
}

assert_service_unchanged() {
	local service="$1"
	local before="$2"
	local after
	after="$(snapshot_service "$service")"
	if [[ "${before}" != "${after}" ]]; then
		die "isolation failure: service '${service}' changed
  before=${before}
  after=${after}"
	fi
	log "unchanged: ${service} (${after})"
}

wait_for_healthy() {
	local service="$1"
	local max_wait="${2:-$HEALTH_WAIT_SECONDS}"
	local elapsed=0 cid status health

	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: skip wait_for_healthy ${service}"
		return 0
	fi

	while (( elapsed < max_wait )); do
		cid="$(service_cid "$service")"
		if [[ -z "${cid}" ]]; then
			sleep 2
			elapsed=$((elapsed + 2))
			continue
		fi
		status="$(docker inspect -f '{{.State.Status}}' "$cid" 2>/dev/null || echo unknown)"
		health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo unknown)"
		if [[ "${status}" == "running" && ( "${health}" == "healthy" || "${health}" == "none" ) ]]; then
			log "${service} healthy (status=${status} health=${health})"
			return 0
		fi
		if [[ "${health}" == "unhealthy" ]]; then
			die "service '${service}' became unhealthy"
		fi
		sleep 2
		elapsed=$((elapsed + 2))
	done
	die "timed out waiting for '${service}' healthy (${max_wait}s)"
}

image_digest_or_id() {
	local ref="$1"
	local digest
	digest="$(docker image inspect "$ref" --format '{{index .RepoDigests 0}}' 2>/dev/null || true)"
	if [[ -n "${digest}" && "${digest}" != "<no value>" ]]; then
		echo "${digest}"
		return 0
	fi
	docker image inspect "$ref" --format '{{.Id}}' 2>/dev/null || echo "missing"
}

image_oci_revision() {
	local ref="$1"
	docker image inspect "$ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' 2>/dev/null || echo ""
}

# Map Compose service → expected local image repository name (project convention).
compose_image_repo() {
	local service="$1"
	case "$service" in
		web) echo "pinblog-saas-web" ;;
		api) echo "pinblog-saas-api" ;;
		*) die "compose_image_repo: unsupported service $service" ;;
	esac
}

# Retag SHA-built seodeva-* image onto the Compose project image name so
# `up --no-deps --force-recreate` (without --build) picks it up.
retag_for_compose() {
	local service="$1"
	local git_sha="$2"
	local src="seodeva-${service}:${git_sha}"
	local repo
	repo="$(compose_image_repo "$service")"
	local dest="${repo}:latest"

	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: docker tag ${src} ${dest}"
		log "DRY_RUN: docker tag ${src} ${repo}"
		return 0
	fi

	docker image inspect "$src" >/dev/null 2>&1 || die "missing built image ${src}"
	run_cmd docker tag "$src" "$dest"
	# Compose Config.Image is often untagged repo name; keep both.
	run_cmd docker tag "$src" "$repo"
}

build_service_image() {
	local service="$1"
	local git_sha="$2"
	export GIT_SHA="${git_sha}"
	export BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: GIT_SHA=${git_sha} ./deploy/scripts/build-images-with-sha.sh ${service}"
		return 0
	fi
	./deploy/scripts/build-images-with-sha.sh "$service"
}

print_image_report() {
	local label="$1"
	local ref="$2"
	echo "---- ${label} ----"
	echo "  ref:      ${ref}"
	if [[ "${DRY_RUN}" == "1" ]]; then
		echo "  (dry-run: inspect skipped)"
		return 0
	fi
	echo "  id:       $(docker image inspect "$ref" --format '{{.Id}}' 2>/dev/null || echo missing)"
	echo "  digest:   $(image_digest_or_id "$ref")"
	echo "  revision: $(image_oci_revision "$ref")"
}

http_check() {
	local url="$1"
	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: curl -fsS -o /dev/null -w '%{http_code}' ${url}"
		return 0
	fi
	local code
	code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)"
	[[ "${code}" =~ ^2 ]] || die "HTTP check failed for ${url} (code=${code:-none})"
	log "HTTP OK ${url} (${code})"
}

forbid_dangerous_git_ops_in_script() {
	# Documentation helper only — actual scripts must never call these.
	:
}
