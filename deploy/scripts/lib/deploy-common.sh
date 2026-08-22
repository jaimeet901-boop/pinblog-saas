#!/usr/bin/env bash
# Shared helpers for service-scoped production deploys + Phase 4 rollback.
# Sourced by deploy-*.sh / rollback-*.sh — not meant to be run directly.

set -euo pipefail

DEPLOY_COMMON_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
APP_HTTP_PORT="${APP_HTTP_PORT:-18080}"
DRY_RUN="${DRY_RUN:-0}"
ALLOW_DIRTY_WORKTREE="${ALLOW_DIRTY_WORKTREE:-0}"
CONFIRM_PRODUCTION="${CONFIRM_PRODUCTION:-}"
HEALTH_WAIT_SECONDS="${HEALTH_WAIT_SECONDS:-180}"
AUTO_ROLLBACK="${AUTO_ROLLBACK:-0}"
DEPLOY_STATE_DIR="${DEPLOY_STATE_DIR:-${DEPLOY_COMMON_ROOT}/deploy/state}"

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
	local action="${2:-deploy}"
	if [[ "${CONFIRM_PRODUCTION}" == "YES" ]]; then
		log "CONFIRM_PRODUCTION=YES accepted for ${service} ${action}"
		return 0
	fi
	echo
	echo "================================================================="
	echo " PRODUCTION ${action} — service: ${service}"
	echo " This will recreate ONLY the '${service}' Compose service."
	echo " Other services must remain unchanged (verified after)."
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

# Soft variant — returns 1 instead of exiting (for deploy failure handling).
assert_service_unchanged_soft() {
	local service="$1"
	local before="$2"
	local after
	after="$(snapshot_service "$service")"
	if [[ "${before}" != "${after}" ]]; then
		warn "isolation failure: service '${service}' changed
  before=${before}
  after=${after}"
		return 1
	fi
	log "unchanged: ${service} (${after})"
	return 0
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

wait_for_healthy_soft() {
	local service="$1"
	local max_wait="${2:-$HEALTH_WAIT_SECONDS}"
	local elapsed=0 cid status health

	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: skip wait_for_healthy_soft ${service}"
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
			warn "service '${service}' became unhealthy"
			return 1
		fi
		sleep 2
		elapsed=$((elapsed + 2))
	done
	warn "timed out waiting for '${service}' healthy (${max_wait}s)"
	return 1
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

compose_image_repo() {
	local service="$1"
	case "$service" in
		web) echo "pinblog-saas-web" ;;
		api) echo "pinblog-saas-api" ;;
		*) die "compose_image_repo: unsupported service $service" ;;
	esac
}

previous_retention_tag() {
	local service="$1"
	echo "seodeva-${service}:previous"
}

state_file_for() {
	local service="$1"
	case "$service" in
		web) echo "${DEPLOY_STATE_DIR}/last-web-deploy.json" ;;
		api) echo "${DEPLOY_STATE_DIR}/last-api-deploy.json" ;;
		*) die "state_file_for: unsupported service $service" ;;
	esac
}

ensure_state_dir() {
	mkdir -p "${DEPLOY_STATE_DIR}"
}

# Atomic JSON write via python3 (no secrets; caller supplies fields).
# Args after service are KEY=VALUE pairs (values must not contain newlines).
atomic_write_deploy_state() {
	local service="$1"
	shift
	local path tmp
	ensure_state_dir
	path="$(state_file_for "$service")"
	tmp="${path}.tmp.$$"

	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: would write state ${path} ($*)"
		return 0
	fi

	STATE_PATH="$tmp" SERVICE_NAME="$service" python3 - "$@" <<'PY'
import json, os, sys
path = os.environ["STATE_PATH"]
data = {"service": os.environ["SERVICE_NAME"]}
for arg in sys.argv[1:]:
    if "=" not in arg:
        raise SystemExit(f"bad state field: {arg}")
    k, v = arg.split("=", 1)
    data[k] = v
# peer_snapshots may be JSON string
if "peer_snapshots_json" in data:
    data["peer_snapshots"] = json.loads(data.pop("peer_snapshots_json"))
# Flatten peer_* keys into peer_snapshots object
peers = {}
for k in list(data.keys()):
    if k.startswith("peer_") and k != "peer_snapshots":
        peers[k[len("peer_"):]] = data.pop(k)
if peers:
    data["peer_snapshots"] = peers
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, sort_keys=True)
    f.write("\n")
PY
	mv -f "$tmp" "$path"
	log "wrote deploy state: ${path}"
}

read_state_field() {
	local service="$1"
	local field="$2"
	local path
	path="$(state_file_for "$service")"
	if [[ ! -f "$path" ]]; then
		echo ""
		return 0
	fi
	STATE_PATH="$path" FIELD="$field" python3 <<'PY'
import json, os
path = os.environ["STATE_PATH"]
field = os.environ["FIELD"]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
val = data.get(field, "")
if isinstance(val, (dict, list)):
    import json as _j
    print(_j.dumps(val))
else:
    print("" if val is None else val)
PY
}

verify_image_id_exists() {
	local image_id="$1"
	[[ -n "${image_id}" && "${image_id}" != "missing" ]] || return 1
	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: would verify image exists: ${image_id}"
		return 0
	fi
	docker image inspect "${image_id}" >/dev/null 2>&1
}

# Tag retention pointer seodeva-{svc}:previous → exact image ID (before Compose retag).
tag_previous_retention() {
	local service="$1"
	local image_id="$2"
	local tag
	tag="$(previous_retention_tag "$service")"
	if [[ -z "${image_id}" || "${image_id}" == "missing" ]]; then
		warn "no previous image ID to retain for ${service}"
		return 1
	fi
	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: docker tag ${image_id} ${tag}"
		return 0
	fi
	verify_image_id_exists "${image_id}" || die "cannot retain previous image; missing: ${image_id}"
	run_cmd docker tag "${image_id}" "${tag}"
	log "retention tag ${tag} → ${image_id}"
}

# Retag an immutable image ID onto Compose project image names (never uses :latest as source).
retag_image_id_for_compose() {
	local service="$1"
	local image_id="$2"
	local repo dest
	repo="$(compose_image_repo "$service")"
	dest="${repo}:latest"

	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: docker tag ${image_id} ${dest}"
		log "DRY_RUN: docker tag ${image_id} ${repo}"
		return 0
	fi

	verify_image_id_exists "${image_id}" || die "image ID not found locally: ${image_id}"
	run_cmd docker tag "${image_id}" "${dest}"
	run_cmd docker tag "${image_id}" "${repo}"
}

# Resolve rollback source: PREVIOUS_IMAGE_ID > state file > seodeva-*:previous
# Prints: image_id|source_label
resolve_previous_image_id() {
	local service="$1"
	local explicit="${PREVIOUS_IMAGE_ID:-}"
	local from_state from_tag resolved tag

	if [[ -n "${explicit}" ]]; then
		echo "${explicit}|explicit:PREVIOUS_IMAGE_ID"
		return 0
	fi

	from_state="$(read_state_field "$service" previous_image_id)"
	if [[ -n "${from_state}" && "${from_state}" != "missing" ]]; then
		echo "${from_state}|state:$(state_file_for "$service")"
		return 0
	fi

	tag="$(previous_retention_tag "$service")"
	if [[ "${DRY_RUN}" == "1" ]]; then
		# In dry-run, still try to resolve if tag exists; else placeholder
		if docker image inspect "$tag" >/dev/null 2>&1; then
			from_tag="$(docker image inspect "$tag" --format '{{.Id}}')"
			echo "${from_tag}|tag:${tag}"
			return 0
		fi
		echo "sha256:dry-run-placeholder|tag:${tag}(missing)"
		return 0
	fi

	if docker image inspect "$tag" >/dev/null 2>&1; then
		from_tag="$(docker image inspect "$tag" --format '{{.Id}}')"
		echo "${from_tag}|tag:${tag}"
		return 0
	fi

	return 1
}

print_rollback_command() {
	local service="$1"
	local image_id="${2:-}"
	echo
	echo "======== ROLLBACK COMMAND ========"
	echo "Manual rollback (no rebuild, no git):"
	if [[ -n "${image_id}" && "${image_id}" != "missing" ]]; then
		echo "  PREVIOUS_IMAGE_ID=${image_id} CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-${service}.sh"
	else
		echo "  CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-${service}.sh"
	fi
	echo "Or with dry-run:"
	echo "  DRY_RUN=1 CONFIRM_PRODUCTION=YES ./deploy/scripts/rollback-${service}.sh"
	echo "=================================="
}

# Perform rollback to an exact image ID. Never builds / never full-stack teardown / never git.
# Peer snapshots: space-separated "svc=snapshot" pairs for services that must stay unchanged.
perform_rollback_to_image_id() {
	local service="$1"
	local image_id="$2"
	local source_label="${3:-unknown}"
	shift 3 || true
	local peer_args=("$@")
	local http_url before_target after_target peer snap_svc snap_val

	log "rollback ${service} → ${image_id} (source=${source_label})"

	if [[ "${DRY_RUN}" != "1" ]]; then
		verify_image_id_exists "${image_id}" || die "rollback aborted: image not found locally: ${image_id}"
	fi

	before_target="$(snapshot_service "$service")"

	retag_image_id_for_compose "$service" "$image_id"
	run_cmd docker compose -f "${COMPOSE_FILE}" up -d --no-deps --force-recreate "$service"

	wait_for_healthy "$service"

	case "$service" in
		web) http_url="http://127.0.0.1:${APP_HTTP_PORT}/" ;;
		api) http_url="http://127.0.0.1:${APP_HTTP_PORT}/api/health" ;;
		*) die "unsupported rollback service $service" ;;
	esac
	http_check "$http_url"

	for peer in "${peer_args[@]}"; do
		snap_svc="${peer%%=*}"
		snap_val="${peer#*=}"
		assert_service_unchanged "$snap_svc" "$snap_val"
	done

	after_target="$(snapshot_service "$service")"
	IFS='|' read -r new_cid new_name new_id <<<"${after_target}"
	IFS='|' read -r old_cid old_name old_id <<<"${before_target}"

	echo
	echo "======== ${service^^} ROLLBACK SUMMARY ========"
	echo "Rollback source:      ${source_label}"
	echo "Restored image ID:    ${image_id}"
	echo "Restored OCI rev:     $(image_oci_revision "${image_id}" 2>/dev/null || echo "")"
	echo "Previous container:   ${old_cid}"
	echo "Restored container:   ${new_cid}"
	echo "Compose image name:   ${new_name}"
	echo "=============================================="

	# Update state to reflect successful rollback (keep previous_image_id as what we restored from's "was current")
	if [[ "${DRY_RUN}" != "1" ]]; then
		atomic_write_deploy_state "$service" \
			"status=rolled_back" \
			"recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
			"previous_image_id=${image_id}" \
			"previous_image_name=$(compose_image_repo "$service")" \
			"previous_container_id=${new_cid}" \
			"previous_oci_revision=$(image_oci_revision "${image_id}")" \
			"new_image_id=${image_id}" \
			"new_sha_tag=" \
			"new_container_id=${new_cid}" \
			"rollback_source=${source_label}" \
			"failure_reason="
	fi
}

# After a failed deploy: preserve state, print command, optionally AUTO_ROLLBACK.
# Args: service reason previous_image_id git_sha before_web before_api before_pb before_nginx
handle_deploy_failure() {
	local service="$1"
	local reason="$2"
	local previous_image_id="$3"
	local git_sha="$4"
	local before_web="$5"
	local before_api="$6"
	local before_pb="$7"
	local before_nginx="$8"

	warn "deploy failed: ${reason}"

	atomic_write_deploy_state "$service" \
		"status=failed" \
		"recorded_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
		"git_sha_deployed=${git_sha}" \
		"previous_image_id=${previous_image_id}" \
		"previous_image_name=$(compose_image_repo "$service")" \
		"previous_oci_revision=$(image_oci_revision "${previous_image_id}" 2>/dev/null || true)" \
		"failure_reason=${reason}" \
		"peer_web=${before_web}" \
		"peer_api=${before_api}" \
		"peer_pocketbase=${before_pb}" \
		"peer_nginx=${before_nginx}"

	print_rollback_command "$service" "$previous_image_id"

	if [[ "${AUTO_ROLLBACK}" == "1" ]]; then
		warn "AUTO_ROLLBACK=1 — attempting rollback to ${previous_image_id}"
		set +e
		if [[ "$service" == "web" ]]; then
			perform_rollback_to_image_id web "$previous_image_id" "auto:previous_image_id" \
				"api=${before_api}" "pocketbase=${before_pb}" "nginx=${before_nginx}"
		else
			perform_rollback_to_image_id api "$previous_image_id" "auto:previous_image_id" \
				"web=${before_web}" "pocketbase=${before_pb}" "nginx=${before_nginx}"
		fi
		local rc=$?
		set -e
		if [[ "$rc" -ne 0 ]]; then
			echo "CRITICAL: AUTO_ROLLBACK failed. Production may be on a bad image." >&2
			echo "Manual intervention required. Do NOT tear down the full stack. Use rollback-${service}.sh with PREVIOUS_IMAGE_ID if the image still exists." >&2
			exit 1
		fi
		log "AUTO_ROLLBACK succeeded"
		exit 1 # original deploy still failed
	fi

	exit 1
}

# Retag SHA-built seodeva-* image onto the Compose project image name.
retag_for_compose() {
	local service="$1"
	local git_sha="$2"
	local src="seodeva-${service}:${git_sha}"

	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: retag ${src} → compose image names"
		retag_image_id_for_compose "$service" "${src}"
		return 0
	fi

	docker image inspect "$src" >/dev/null 2>&1 || die "missing built image ${src}"
	local id
	id="$(docker image inspect "$src" --format '{{.Id}}')"
	retag_image_id_for_compose "$service" "$id"
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

http_check_soft() {
	local url="$1"
	if [[ "${DRY_RUN}" == "1" ]]; then
		log "DRY_RUN: curl -fsS -o /dev/null -w '%{http_code}' ${url}"
		return 0
	fi
	local code
	code="$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 15 "$url" || true)"
	if [[ "${code}" =~ ^2 ]]; then
		log "HTTP OK ${url} (${code})"
		return 0
	fi
	warn "HTTP check failed for ${url} (code=${code:-none})"
	return 1
}
