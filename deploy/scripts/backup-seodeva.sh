#!/usr/bin/env bash
# Seodeva production logical backup — PocketBase pb_data + env + manifest to S3.
# Must run as root. Stops ONLY pocketbase during archive creation.
set -euo pipefail

readonly SCRIPT_NAME='backup-seodeva'
readonly PROJECT_ROOT='/home/ec2-user/pinblog-saas'
readonly COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
readonly PB_DATA_DIR="${PROJECT_ROOT}/apps/pocketbase/pb_data"
readonly PB_VERSION_FILE="${PROJECT_ROOT}/apps/pocketbase/.pocketbase-version"
readonly POCKETBASE_SERVICE='pocketbase'
readonly POCKETBASE_CONTAINER='pinblog-saas-pocketbase-1'

readonly S3_BUCKET='seodeva-pinblog-backups-106088256806'
readonly S3_REGION='eu-north-1'
readonly S3_PREFIX_PB='pb_data/daily'
readonly S3_PREFIX_ENV='env/daily'
readonly S3_PREFIX_MANIFEST='manifests/daily'

readonly LOCK_FILE='/var/run/seodeva-backup.lock'
readonly MIN_FREE_KB=524288 # 512 MiB headroom for temp archives
readonly S3_VERIFY_RETRIES=6
readonly S3_VERIFY_DELAY_SEC=2
readonly PB_RECOVERY_ATTEMPTS=3
readonly PB_HEALTH_WAIT_ATTEMPTS=40
readonly PB_HEALTH_WAIT_SEC=3

readonly ENV_FILES=(
	"${PROJECT_ROOT}/apps/api/.env"
	"${PROJECT_ROOT}/.env"
	'/etc/nginx/conf.d/seodeva.conf'
)

BACKUP_ID=''
WORK_DIR=''
PB_WAS_STOPPED=0
PB_RESTARTED=0
PB_STOP_EPOCH=0
PB_START_EPOCH=0
START_EPOCH=0
CRITICAL_PB_FAILURE=0
SQLITE_VALIDATION='skipped'
SQLITE_VALIDATION_NOTE=''

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
log_error() { log "ERROR: $*" >&2; }

require_root() {
	if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
		log_error "This script must run as root."
		exit 1
	fi
}

acquire_lock() {
	exec 9>"${LOCK_FILE}"
	if ! flock -n 9; then
		log_error "Another backup is already running (lock: ${LOCK_FILE})."
		exit 1
	fi
}

release_lock() {
	flock -u 9 2>/dev/null || true
}

verify_aws_identity() {
	if ! command -v aws >/dev/null 2>&1; then
		log_error "aws CLI is not installed."
		exit 1
	fi

	local identity
	if ! identity="$(aws sts get-caller-identity --output json 2>&1)"; then
		log_error "aws sts get-caller-identity failed: ${identity}"
		exit 1
	fi

	local arn account
	arn="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Arn"])' <<<"${identity}")"
	account="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["Account"])' <<<"${identity}")"

	if [[ "${account}" != '106088256806' ]]; then
		log_error "Unexpected AWS account: ${account}"
		exit 1
	fi
	if [[ "${arn}" != *'seodeva-pinblog-backup-role'* ]]; then
		log_error "Unexpected AWS identity ARN: ${arn}"
		exit 1
	fi

	log "AWS identity verified: ${arn}"
}

verify_disk_space() {
	local avail_kb
	avail_kb="$(df -Pk "${PROJECT_ROOT}" | awk 'NR==2 {print $4}')"
	if [[ -z "${avail_kb}" || "${avail_kb}" -lt "${MIN_FREE_KB}" ]]; then
		log_error "Insufficient disk space on ${PROJECT_ROOT} (need >= ${MIN_FREE_KB} KiB free)."
		exit 1
	fi
	log "Disk space OK (${avail_kb} KiB free on ${PROJECT_ROOT})."
}

verify_paths() {
	local missing=0
	if [[ ! -d "${PB_DATA_DIR}" ]]; then
		log_error "Missing pb_data directory: ${PB_DATA_DIR}"
		missing=1
	fi
	for f in "${ENV_FILES[@]}"; do
		if [[ ! -f "${f}" ]]; then
			log_error "Missing required env file: ${f}"
			missing=1
		fi
	done
	if [[ ! -f "${COMPOSE_FILE}" ]]; then
		log_error "Missing compose file: ${COMPOSE_FILE}"
		missing=1
	fi
	if [[ "${missing}" -ne 0 ]]; then
		exit 1
	fi
}

s3_object_exists() {
	local key="$1"
	local result count
	result="$(aws s3api list-objects-v2 \
		--bucket "${S3_BUCKET}" \
		--prefix "${key}" \
		--max-keys 1 \
		--output json 2>&1)" || {
		log_error "Failed to check S3 key existence for s3://${S3_BUCKET}/${key}: ${result}"
		return 2
	}
	count="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("KeyCount", 0))' <<<"${result}")"
	if [[ "${count}" -gt 0 ]]; then
		local exact
		exact="$(python3 -c 'import json,sys; c=json.load(sys.stdin); ks=c.get("Contents") or []; print(ks[0]["Key"] if ks else "")' <<<"${result}")"
		if [[ "${exact}" == "${key}" ]]; then
			return 0
		fi
	fi
	return 1
}

s3_object_exists_with_retry() {
	local key="$1"
	local attempt
	for (( attempt=1; attempt<=S3_VERIFY_RETRIES; attempt++ )); do
		if s3_object_exists "${key}"; then
			return 0
		fi
		local rc=$?
		if [[ "${rc}" -eq 2 ]]; then
			return 2
		fi
		if (( attempt < S3_VERIFY_RETRIES )); then
			log "S3 object not yet listed for s3://${S3_BUCKET}/${key}; retry ${attempt}/${S3_VERIFY_RETRIES} in ${S3_VERIFY_DELAY_SEC}s..."
			sleep "${S3_VERIFY_DELAY_SEC}"
		fi
	done
	return 1
}

verify_s3_keys_unique() {
	local pb_key="$1" env_key="$2" manifest_key="$3"
	local key rc
	for key in "${pb_key}" "${env_key}" "${manifest_key}"; do
		if s3_object_exists "${key}"; then
			log_error "Refusing to overwrite existing S3 object: s3://${S3_BUCKET}/${key}"
			exit 1
		fi
		rc=$?
		if [[ "${rc}" -eq 2 ]]; then
			exit 1
		fi
	done
	log "S3 keys are unique (not present in bucket)."
}

detect_sqlite_validator() {
	if command -v sqlite3 >/dev/null 2>&1; then
		echo 'sqlite3'
	elif command -v python3 >/dev/null 2>&1; then
		echo 'python3'
	else
		echo 'none'
	fi
}

validate_sqlite_databases() {
	local validator pb_dir
	validator="$(detect_sqlite_validator)"
	pb_dir="${PB_DATA_DIR}"

	case "${validator}" in
		sqlite3)
			SQLITE_VALIDATION='passed'
			for db in data.db auxiliary.db; do
				local path="${pb_dir}/${db}"
				if [[ ! -f "${path}" ]]; then
					log_error "Missing database file: ${path}"
					SQLITE_VALIDATION='failed'
					return 1
				fi
				local result
				result="$(sqlite3 "${path}" 'PRAGMA integrity_check;' 2>&1)" || {
					log_error "sqlite3 integrity_check failed for ${db}: ${result}"
					SQLITE_VALIDATION='failed'
					return 1
				}
				if [[ "${result}" != 'ok' ]]; then
					log_error "integrity_check for ${db} returned: ${result}"
					SQLITE_VALIDATION='failed'
					return 1
				fi
				log "SQLite integrity_check OK (${db})."
			done
			;;
		python3)
			SQLITE_VALIDATION='passed'
			if ! python3 - "${pb_dir}" <<'PY'
import sqlite3, sys
base = sys.argv[1]
for name in ("data.db", "auxiliary.db"):
    path = f"{base}/{name}"
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    result = conn.execute("PRAGMA integrity_check").fetchone()[0]
    conn.close()
    if result != "ok":
        raise SystemExit(f"{name}: integrity_check={result}")
    print(f"{name}: integrity_check=ok")
PY
			then
				log_error "Python SQLite integrity_check failed."
				SQLITE_VALIDATION='failed'
				return 1
			fi
			SQLITE_VALIDATION_NOTE='validated via python3 (sqlite3 CLI not installed)'
			log "SQLite integrity_check OK (python3)."
			;;
		none)
			SQLITE_VALIDATION='skipped'
			SQLITE_VALIDATION_NOTE='no sqlite3 or python3 available; backup proceeds with PocketBase stopped'
			log "WARNING: No SQLite validator available; skipping integrity_check."
			;;
	esac
	return 0
}

finalize_sqlite_for_archive() {
	if ! command -v python3 >/dev/null 2>&1; then
		log_error "python3 is required for SQLite WAL finalization before archive."
		return 1
	fi

	log "Finalizing SQLite files for archive (checkpoint + remove empty sidecars)..."
	if ! python3 - "${PB_DATA_DIR}" <<'PY'
import os
import sqlite3
import sys

base = sys.argv[1]
for name in ("data.db", "auxiliary.db"):
    path = os.path.join(base, name)
    if not os.path.isfile(path):
        raise SystemExit(f"missing database file: {path}")
    conn = sqlite3.connect(path)
    try:
        conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    finally:
        conn.close()
    for suffix in ("-wal", "-shm"):
        sidecar = path + suffix
        if not os.path.exists(sidecar):
            continue
        size = os.path.getsize(sidecar)
        if size != 0:
            raise SystemExit(
                f"refusing backup: non-empty sidecar {sidecar} ({size} bytes); "
                "PocketBase may not have stopped cleanly"
            )
        os.remove(sidecar)
PY
	then
		log_error "SQLite finalization failed."
		return 1
	fi
	log "SQLite sidecars removed; ready for archive."
}

pocketbase_has_healthcheck() {
	local raw
	raw="$(docker inspect "${POCKETBASE_CONTAINER}" --format '{{json .Config.Healthcheck}}' 2>/dev/null || echo 'null')"
	[[ -n "${raw}" && "${raw}" != 'null' && "${raw}" != '{}' ]]
}

pocketbase_container_state() {
	local status health
	status="$(docker inspect "${POCKETBASE_CONTAINER}" --format '{{.State.Status}}' 2>/dev/null || echo 'missing')"
	if pocketbase_has_healthcheck; then
		health="$(docker inspect "${POCKETBASE_CONTAINER}" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' 2>/dev/null || echo 'missing')"
	else
		health='none'
	fi
	printf '%s %s\n' "${status}" "${health}"
}

verify_pocketbase_stopped() {
	local status health
	read -r status health <<<"$(pocketbase_container_state)"
	if [[ "${status}" == 'running' ]]; then
		log_error "PocketBase container is still running (health=${health}); refusing to archive pb_data."
		return 1
	fi
	if [[ "${status}" == 'missing' ]]; then
		log_error "PocketBase container ${POCKETBASE_CONTAINER} not found after stop."
		return 1
	fi
	log "PocketBase container confirmed stopped (status=${status})."
	return 0
}

wait_for_pocketbase_healthy() {
	local status health attempts=0 has_healthcheck=0
	if pocketbase_has_healthcheck; then
		has_healthcheck=1
		log "Docker healthcheck configured; waiting for status=running and health=healthy."
	else
		log "WARNING: No Docker healthcheck on ${POCKETBASE_CONTAINER}; waiting for status=running only."
	fi

	while (( attempts < PB_HEALTH_WAIT_ATTEMPTS )); do
		read -r status health <<<"$(pocketbase_container_state)"
		if [[ "${status}" == 'running' ]]; then
			if [[ "${has_healthcheck}" -eq 1 ]]; then
				if [[ "${health}" == 'healthy' ]]; then
					log "PocketBase is running and healthy."
					return 0
				fi
			else
				log "PocketBase is running (no Docker healthcheck configured)."
				return 0
			fi
		fi
		sleep "${PB_HEALTH_WAIT_SEC}"
		attempts=$((attempts + 1))
	done

	read -r status health <<<"$(pocketbase_container_state)"
	if [[ "${has_healthcheck}" -eq 1 ]]; then
		log_error "PocketBase did not become healthy in time (status=${status}, health=${health})."
	else
		log_error "PocketBase did not reach running state in time (status=${status})."
	fi
	return 1
}

start_pocketbase() {
	log "Starting PocketBase container (${POCKETBASE_SERVICE})..."
	PB_RESTARTED=0

	if ! (
		cd "${PROJECT_ROOT}"
		docker compose -f "${COMPOSE_FILE}" start "${POCKETBASE_SERVICE}"
	); then
		log_error "docker compose start ${POCKETBASE_SERVICE} failed."
		return 1
	fi

	if wait_for_pocketbase_healthy; then
		PB_START_EPOCH="$(date +%s)"
		PB_RESTARTED=1
		return 0
	fi

	PB_RESTARTED=0
	return 1
}

ensure_pocketbase_running() {
	local attempt

	if [[ "${PB_RESTARTED}" -eq 1 ]]; then
		if wait_for_pocketbase_healthy; then
			return 0
		fi
		log_error "PocketBase was marked restarted but is no longer healthy; attempting recovery."
		PB_RESTARTED=0
	fi

	for (( attempt=1; attempt<=PB_RECOVERY_ATTEMPTS; attempt++ )); do
		log_error "PocketBase recovery attempt ${attempt}/${PB_RECOVERY_ATTEMPTS}..."
		if start_pocketbase; then
			log "PocketBase recovery succeeded on attempt ${attempt}."
			return 0
		fi
		if (( attempt < PB_RECOVERY_ATTEMPTS )); then
			sleep 5
		fi
	done

	log_error "CRITICAL: PocketBase could not be restored to a running/healthy state after ${PB_RECOVERY_ATTEMPTS} attempts."
	return 1
}

emergency_restart_pocketbase() {
	if [[ "${PB_WAS_STOPPED}" -eq 1 && "${PB_RESTARTED}" -eq 0 ]]; then
		log_error "Attempting emergency PocketBase recovery after failure..."
		if ! ensure_pocketbase_running; then
			CRITICAL_PB_FAILURE=1
			return 1
		fi
	fi
	return 0
}

abort_backup_preserve_pocketbase() {
	log_error "$1"
	if ! ensure_pocketbase_running; then
		CRITICAL_PB_FAILURE=1
	fi
	exit 1
}

stop_pocketbase() {
	log "Stopping PocketBase container (${POCKETBASE_SERVICE})..."
	PB_STOP_EPOCH="$(date +%s)"
	PB_WAS_STOPPED=1
	PB_RESTARTED=0
	(
		cd "${PROJECT_ROOT}"
		docker compose -f "${COMPOSE_FILE}" stop "${POCKETBASE_SERVICE}"
	)
	log "docker compose stop ${POCKETBASE_SERVICE} completed."
}

create_pb_archive() {
	local archive="$1"
	log "Creating pb_data archive..."
	(
		cd "${PROJECT_ROOT}/apps/pocketbase"
		tar czf "${archive}" pb_data
	)
	chmod 600 "${archive}"
	if ! tar tzf "${archive}" >/dev/null 2>&1; then
		log_error "pb_data archive validation failed (tar tzf)."
		return 1
	fi
	log "pb_data archive created and validated."
}

create_env_archive() {
	local archive="$1" staging="$2"
	mkdir -p "${staging}/home/ec2-user/pinblog-saas/apps/api" \
		"${staging}/home/ec2-user/pinblog-saas" \
		"${staging}/etc/nginx/conf.d"

	install -m 600 "${PROJECT_ROOT}/apps/api/.env" "${staging}/home/ec2-user/pinblog-saas/apps/api/.env"
	install -m 600 "${PROJECT_ROOT}/.env" "${staging}/home/ec2-user/pinblog-saas/.env"
	install -m 644 '/etc/nginx/conf.d/seodeva.conf' "${staging}/etc/nginx/conf.d/seodeva.conf"

	(
		cd "${staging}"
		tar czf "${archive}" home etc
	)
	chmod 600 "${archive}"
	if ! tar tzf "${archive}" >/dev/null 2>&1; then
		log_error "env archive validation failed (tar tzf)."
		return 1
	fi
	log "env archive created and validated."
}

sha256_file() {
	sha256sum "$1" | awk '{print $1}'
}

upload_s3_object() {
	local local_path="$1" s3_key="$2"
	local rc
	log "Uploading s3://${S3_BUCKET}/${s3_key} ..."
	aws s3 cp "${local_path}" "s3://${S3_BUCKET}/${s3_key}" --region "${S3_REGION}" --only-show-errors
	if s3_object_exists_with_retry "${s3_key}"; then
		log "Upload verified: s3://${S3_BUCKET}/${s3_key}"
		return 0
	fi
	rc=$?
	if [[ "${rc}" -eq 2 ]]; then
		log_error "Upload verification API error for s3://${S3_BUCKET}/${s3_key}"
	else
		log_error "Upload verification failed for s3://${S3_BUCKET}/${s3_key} after ${S3_VERIFY_RETRIES} attempts"
	fi
	return 1
}

get_instance_metadata() {
	local token instance_id region
	token="$(curl -s -X PUT 'http://169.254.169.254/latest/api/token' -H 'X-aws-ec2-metadata-token-ttl-seconds: 21600')"
	instance_id="$(curl -s -H "X-aws-ec2-metadata-token: ${token}" http://169.254.169.254/latest/dynamic/instance-identity/document | python3 -c 'import json,sys; print(json.load(sys.stdin)["instanceId"])')"
	region="$(curl -s -H "X-aws-ec2-metadata-token: ${token}" http://169.254.169.254/latest/dynamic/instance-identity/document | python3 -c 'import json,sys; print(json.load(sys.stdin)["region"])')"
	printf '%s %s\n' "${instance_id}" "${region}"
}

get_git_commit() {
	if git -C "${PROJECT_ROOT}" rev-parse HEAD >/dev/null 2>&1; then
		git -C "${PROJECT_ROOT}" rev-parse HEAD
	else
		echo 'unknown'
	fi
}

get_pocketbase_version() {
	if [[ -f "${PB_VERSION_FILE}" ]]; then
		tr -d '[:space:]' < "${PB_VERSION_FILE}"
	else
		echo 'unknown'
	fi
}

write_manifest() {
	local manifest_path="$1"
	local pb_key="$2" env_key="$3"
	local pb_bytes="$4" env_bytes="$5"
	local pb_sha="$6" env_sha="$7"
	local end_epoch="$8"
	local instance_id region git_commit pb_version pb_downtime total_duration

	read -r instance_id region <<<"$(get_instance_metadata)"
	git_commit="$(get_git_commit)"
	pb_version="$(get_pocketbase_version)"
	pb_downtime=0
	if [[ "${PB_STOP_EPOCH}" -gt 0 && "${PB_START_EPOCH}" -gt 0 ]]; then
		pb_downtime=$((PB_START_EPOCH - PB_STOP_EPOCH))
	fi
	total_duration=$((end_epoch - START_EPOCH))

	MANIFEST_PATH="${manifest_path}" \
	MANIFEST_BACKUP_ID="${BACKUP_ID}" \
	MANIFEST_INSTANCE_ID="${instance_id}" \
	MANIFEST_REGION="${region}" \
	MANIFEST_BUCKET="${S3_BUCKET}" \
	MANIFEST_GIT_COMMIT="${git_commit}" \
	MANIFEST_PB_VERSION="${pb_version}" \
	MANIFEST_PB_KEY="${pb_key}" \
	MANIFEST_ENV_KEY="${env_key}" \
	MANIFEST_PB_BYTES="${pb_bytes}" \
	MANIFEST_ENV_BYTES="${env_bytes}" \
	MANIFEST_PB_SHA="${pb_sha}" \
	MANIFEST_ENV_SHA="${env_sha}" \
	MANIFEST_SQLITE_VALIDATION="${SQLITE_VALIDATION}" \
	MANIFEST_SQLITE_NOTE="${SQLITE_VALIDATION_NOTE}" \
	MANIFEST_PB_DOWNTIME="${pb_downtime}" \
	MANIFEST_TOTAL_DURATION="${total_duration}" \
	python3 <<'PY'
import json
import os
from datetime import datetime, timezone

manifest = {
    "backup_id": os.environ["MANIFEST_BACKUP_ID"],
    "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "instance_id": os.environ["MANIFEST_INSTANCE_ID"],
    "region": os.environ["MANIFEST_REGION"],
    "bucket": os.environ["MANIFEST_BUCKET"],
    "git_commit": os.environ["MANIFEST_GIT_COMMIT"],
    "pocketbase_version": os.environ["MANIFEST_PB_VERSION"],
    "archives": {
        "pb_data": {
            "s3_key": os.environ["MANIFEST_PB_KEY"],
            "bytes": int(os.environ["MANIFEST_PB_BYTES"]),
            "sha256": os.environ["MANIFEST_PB_SHA"],
        },
        "env": {
            "s3_key": os.environ["MANIFEST_ENV_KEY"],
            "bytes": int(os.environ["MANIFEST_ENV_BYTES"]),
            "sha256": os.environ["MANIFEST_ENV_SHA"],
        },
    },
    "integrity_checks": {
        "sqlite_validation": os.environ["MANIFEST_SQLITE_VALIDATION"],
        "sqlite_validation_note": os.environ["MANIFEST_SQLITE_NOTE"],
    },
    "durations_seconds": {
        "pocketbase_downtime": int(os.environ["MANIFEST_PB_DOWNTIME"]),
        "total_backup": int(os.environ["MANIFEST_TOTAL_DURATION"]),
    },
    "status": "complete",
}

path = os.environ["MANIFEST_PATH"]
with open(path, "w", encoding="utf-8") as fh:
    json.dump(manifest, fh, indent=2, sort_keys=True)
    fh.write("\n")
PY
	chmod 600 "${manifest_path}"
}

cleanup_workdir() {
	if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
		rm -rf "${WORK_DIR}"
	fi
}

on_exit() {
	local exit_code=$?
	if ! emergency_restart_pocketbase; then
		exit_code=1
	fi
	cleanup_workdir
	release_lock
	if [[ "${CRITICAL_PB_FAILURE}" -eq 1 ]]; then
		exit_code=1
		log_error "CRITICAL: PocketBase recovery failed; manual intervention required."
	fi
	if [[ "${exit_code}" -ne 0 ]]; then
		log_error "${SCRIPT_NAME} failed (exit ${exit_code}). No complete manifest was uploaded."
	fi
	exit "${exit_code}"
}

main() {
	require_root
	acquire_lock
	trap on_exit EXIT

	START_EPOCH="$(date +%s)"
	BACKUP_ID="$(date -u +'%Y%m%dT%H%M%SZ')"
	WORK_DIR="$(mktemp -d /var/tmp/seodeva-backup.XXXXXX)"
	chmod 700 "${WORK_DIR}"

	local pb_archive="${WORK_DIR}/pb_data-${BACKUP_ID}.tar.gz"
	local env_archive="${WORK_DIR}/env-${BACKUP_ID}.tar.gz"
	local env_staging="${WORK_DIR}/env-staging"
	local manifest_path="${WORK_DIR}/manifest-${BACKUP_ID}.json"

	local pb_key="${S3_PREFIX_PB}/pb_data-${BACKUP_ID}.tar.gz"
	local env_key="${S3_PREFIX_ENV}/env-${BACKUP_ID}.tar.gz"
	local manifest_key="${S3_PREFIX_MANIFEST}/manifest-${BACKUP_ID}.json"

	log "Starting Seodeva backup ${BACKUP_ID}"

	verify_aws_identity
	verify_disk_space
	verify_paths
	verify_s3_keys_unique "${pb_key}" "${env_key}" "${manifest_key}"

	stop_pocketbase
	if ! verify_pocketbase_stopped; then
		abort_backup_preserve_pocketbase "PocketBase did not stop cleanly; aborting before archive creation."
	fi

	if ! validate_sqlite_databases; then
		log_error "SQLite validation failed; aborting before archive creation."
		if ! ensure_pocketbase_running; then
			CRITICAL_PB_FAILURE=1
		fi
		exit 1
	fi

	if ! finalize_sqlite_for_archive; then
		log_error "SQLite finalization failed; aborting before archive creation."
		if ! ensure_pocketbase_running; then
			CRITICAL_PB_FAILURE=1
		fi
		exit 1
	fi

	create_pb_archive "${pb_archive}"
	if ! start_pocketbase; then
		log_error "Failed to restart PocketBase after pb_data archive creation."
		if ! ensure_pocketbase_running; then
			CRITICAL_PB_FAILURE=1
		fi
		exit 1
	fi

	create_env_archive "${env_archive}" "${env_staging}"

	local pb_sha env_sha pb_bytes env_bytes
	pb_sha="$(sha256_file "${pb_archive}")"
	env_sha="$(sha256_file "${env_archive}")"
	pb_bytes="$(stat -c '%s' "${pb_archive}")"
	env_bytes="$(stat -c '%s' "${env_archive}")"

	upload_s3_object "${pb_archive}" "${pb_key}"
	upload_s3_object "${env_archive}" "${env_key}"

	local end_epoch
	end_epoch="$(date +%s)"
	write_manifest "${manifest_path}" "${pb_key}" "${env_key}" \
		"${pb_bytes}" "${env_bytes}" "${pb_sha}" "${env_sha}" "${end_epoch}"

	upload_s3_object "${manifest_path}" "${manifest_key}"

	log "Backup ${BACKUP_ID} completed successfully."
	log "Manifest: s3://${S3_BUCKET}/${manifest_key}"
}

main "$@"
