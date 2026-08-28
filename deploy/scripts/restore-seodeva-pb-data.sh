#!/usr/bin/env bash
# Seodeva backup restore helper — DRY-RUN / isolated validation by default.
# Does NOT overwrite production pb_data unless --production-restore is explicitly passed.
set -euo pipefail

readonly PROJECT_ROOT='/home/ec2-user/pinblog-saas'
readonly PB_DATA_DIR="${PROJECT_ROOT}/apps/pocketbase/pb_data"
readonly S3_BUCKET='seodeva-pinblog-backups-106088256806'
readonly S3_REGION='eu-north-1'

MANIFEST_PATH=''
DOWNLOAD=0
PRODUCTION_RESTORE=0
WORK_DIR=''

usage() {
	cat <<'EOF'
Usage: restore-seodeva-pb-data.sh [options]

Options:
  --manifest PATH|s3://bucket/key   Local manifest JSON or S3 URI (required)
  --download                       Download referenced archives from S3
  --production-restore             DANGEROUS: overwrite production pb_data (not for first drill)
  -h, --help                       Show this help

Default behavior (no --production-restore):
  - Validates manifest fields and checksums when archives are available locally or via --download
  - Extracts pb_data into an isolated directory under /var/tmp/seodeva-restore-test.*
  - Never modifies production pb_data
EOF
}

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
log_error() { log "ERROR: $*"; }

parse_args() {
	while [[ $# -gt 0 ]]; do
		case "$1" in
			--manifest)
				MANIFEST_PATH="$2"
				shift 2
				;;
			--download)
				DOWNLOAD=1
				shift
				;;
			--production-restore)
				PRODUCTION_RESTORE=1
				shift
				;;
			-h|--help)
				usage
				exit 0
				;;
			*)
				log_error "Unknown argument: $1"
				usage
				exit 1
				;;
		esac
	done

	if [[ -z "${MANIFEST_PATH}" ]]; then
		log_error "--manifest is required."
		usage
		exit 1
	fi
}

sha256_file() {
	sha256sum "$1" | awk '{print $1}'
}

fetch_manifest() {
	if [[ "${MANIFEST_PATH}" == s3://* ]]; then
		local uri="${MANIFEST_PATH#s3://}"
		local bucket="${uri%%/*}"
		local key="${uri#*/}"
		local dest="${WORK_DIR}/manifest.json"
		aws s3 cp "s3://${bucket}/${key}" "${dest}" --region "${S3_REGION}" --only-show-errors
		echo "${dest}"
	else
		if [[ ! -f "${MANIFEST_PATH}" ]]; then
			log_error "Manifest not found: ${MANIFEST_PATH}"
			exit 1
		fi
		cp "${MANIFEST_PATH}" "${WORK_DIR}/manifest.json"
		echo "${WORK_DIR}/manifest.json"
	fi
}

read_manifest_field() {
	local manifest="$1" py_expr="$2"
	python3 - "${manifest}" <<PY
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
${py_expr}
PY
}

maybe_download_archive() {
	local s3_key="$1" local_name="$2"
	local dest="${WORK_DIR}/${local_name}"
	if [[ "${DOWNLOAD}" -eq 1 ]]; then
		log "Downloading s3://${S3_BUCKET}/${s3_key} ..."
		aws s3 cp "s3://${S3_BUCKET}/${s3_key}" "${dest}" --region "${S3_REGION}" --only-show-errors
	fi
	if [[ -f "${dest}" ]]; then
		echo "${dest}"
		return 0
	fi
	return 1
}

verify_archive_checksum() {
	local archive="$1" expected_sha="$2"
	local actual
	actual="$(sha256_file "${archive}")"
	if [[ "${actual}" != "${expected_sha}" ]]; then
		log_error "SHA-256 mismatch for ${archive}"
		log_error "Expected: ${expected_sha}"
		log_error "Actual:   ${actual}"
		return 1
	fi
	log "SHA-256 verified for $(basename "${archive}")."
}

validate_sqlite_in_dir() {
	local pb_dir="$1"
	if command -v sqlite3 >/dev/null 2>&1; then
		for db in data.db auxiliary.db; do
			local result
			result="$(sqlite3 "${pb_dir}/${db}" 'PRAGMA integrity_check;' 2>&1)" || {
				log_error "sqlite3 integrity_check failed for ${db}: ${result}"
				return 1
			}
			if [[ "${result}" != 'ok' ]]; then
				log_error "integrity_check for ${db}: ${result}"
				return 1
			fi
			log "integrity_check OK (${db})."
		done
	elif command -v python3 >/dev/null 2>&1; then
		python3 - "${pb_dir}" <<'PY'
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
	else
		log "WARNING: No sqlite3/python3 available; skipping integrity_check in restore test."
	fi
}

isolated_restore_test() {
	local pb_archive="$1"
	local extract_root="${WORK_DIR}/restore-test"
	mkdir -p "${extract_root}"
	tar xzf "${pb_archive}" -C "${extract_root}"
	if [[ ! -d "${extract_root}/pb_data" ]]; then
		log_error "Archive did not contain pb_data/ at expected path."
		return 1
	fi
	validate_sqlite_in_dir "${extract_root}/pb_data"
	log "Isolated restore test succeeded: ${extract_root}/pb_data"
}

production_restore() {
	local pb_archive="$1"
	log_error "Refusing production restore without explicit confirmation."
	log_error "Production restore is implemented as a guarded future step."
	log_error "To proceed manually after isolated test passes:"
	log_error "  1. Stop pocketbase"
	log_error "  2. Move aside ${PB_DATA_DIR} to pb_data.pre-restore-<timestamp>"
	log_error "  3. Extract archive into apps/pocketbase/"
	log_error "  4. Start pocketbase and verify health"
	exit 2
}

cleanup() {
	if [[ -n "${WORK_DIR}" && -d "${WORK_DIR}" ]]; then
		rm -rf "${WORK_DIR}"
	fi
}

main() {
	parse_args "$@"
	WORK_DIR="$(mktemp -d /var/tmp/seodeva-restore-test.XXXXXX)"
	trap cleanup EXIT

	local manifest
	manifest="$(fetch_manifest)"

	local status backup_id pb_key env_key pb_sha env_sha
	status="$(read_manifest_field "${manifest}" 'print(data.get("status", ""))')"
	backup_id="$(read_manifest_field "${manifest}" 'print(data.get("backup_id", ""))')"
	pb_key="$(read_manifest_field "${manifest}" 'print(data["archives"]["pb_data"]["s3_key"])')"
	env_key="$(read_manifest_field "${manifest}" 'print(data["archives"]["env"]["s3_key"])')"
	pb_sha="$(read_manifest_field "${manifest}" 'print(data["archives"]["pb_data"]["sha256"])')"
	env_sha="$(read_manifest_field "${manifest}" 'print(data["archives"]["env"]["sha256"])')"

	log "Manifest backup_id=${backup_id} status=${status}"

	if [[ "${status}" != 'complete' ]]; then
		log_error "Manifest status is not complete; refusing restore test."
		exit 1
	fi

	local pb_archive env_archive
	if ! pb_archive="$(maybe_download_archive "${pb_key}" "pb_data-${backup_id}.tar.gz")"; then
		log_error "pb_data archive not available locally. Re-run with --download."
		exit 1
	fi
	if ! env_archive="$(maybe_download_archive "${env_key}" "env-${backup_id}.tar.gz")"; then
		log "Env archive not downloaded (optional for pb_data isolated test)."
	fi

	verify_archive_checksum "${pb_archive}" "${pb_sha}"
	if [[ -n "${env_archive:-}" && -f "${env_archive}" ]]; then
		verify_archive_checksum "${env_archive}" "${env_sha}"
	fi

	if [[ "${PRODUCTION_RESTORE}" -eq 1 ]]; then
		production_restore "${pb_archive}"
	fi

	isolated_restore_test "${pb_archive}"
	log "DRY-RUN / isolated restore validation completed successfully."
}

main "$@"
