#!/usr/bin/env bash
# Read-only Seodeva backup manifest verifier.
set -euo pipefail

readonly S3_BUCKET='seodeva-pinblog-backups-106088256806'
readonly S3_REGION='eu-north-1'

MANIFEST_PATH=''
DOWNLOAD=0

usage() {
	cat <<'EOF'
Usage: verify-backup-manifest.sh [options]

Options:
  --manifest PATH|s3://bucket/key   Local manifest JSON or S3 URI (required)
  --download                        Download archives and verify SHA-256 locally
  -h, --help                        Show this help

Read-only: never modifies production data or deletes S3 objects.
EOF
}

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }
log_error() { log "ERROR: $*" >&2; }

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

load_manifest() {
	local dest
	dest="$(mktemp /var/tmp/seodeva-manifest.XXXXXX.json)"
	if [[ "${MANIFEST_PATH}" == s3://* ]]; then
		local uri="${MANIFEST_PATH#s3://}"
		local bucket="${uri%%/*}"
		local key="${uri#*/}"
		aws s3 cp "s3://${bucket}/${key}" "${dest}" --region "${S3_REGION}" --only-show-errors
	else
		cp "${MANIFEST_PATH}" "${dest}"
	fi
	echo "${dest}"
}

manifest_field() {
	local manifest="$1"
	python3 - "${manifest}" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding="utf-8"))
print(json.dumps(data, indent=2, sort_keys=True))
PY
}

s3_object_present() {
	local key="$1"
	local result count exact
	result="$(aws s3api list-objects-v2 \
		--bucket "${S3_BUCKET}" \
		--prefix "${key}" \
		--max-keys 1 \
		--output json)"
	count="$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("KeyCount", 0))' <<<"${result}")"
	if [[ "${count}" -eq 0 ]]; then
		return 1
	fi
	exact="$(python3 -c 'import json,sys; c=json.load(sys.stdin); ks=c.get("Contents") or []; print(ks[0]["Key"] if ks else "")' <<<"${result}")"
	[[ "${exact}" == "${key}" ]]
}

sha256_file() {
	sha256sum "$1" | awk '{print $1}'
}

verify_checksum_if_downloaded() {
	local s3_key="$1" expected_sha="$2"
	local tmp
	tmp="$(mktemp /var/tmp/seodeva-verify.XXXXXX)"
	if [[ "${DOWNLOAD}" -eq 1 ]]; then
		log "Downloading s3://${S3_BUCKET}/${s3_key} for checksum verification..."
		aws s3 cp "s3://${S3_BUCKET}/${s3_key}" "${tmp}" --region "${S3_REGION}" --only-show-errors
		local actual
		actual="$(sha256_file "${tmp}")"
		if [[ "${actual}" != "${expected_sha}" ]]; then
			log_error "SHA-256 mismatch for ${s3_key}"
			log_error "Expected: ${expected_sha}"
			log_error "Actual:   ${actual}"
			rm -f "${tmp}"
			exit 1
		fi
		log "SHA-256 OK for ${s3_key}"
	fi
	rm -f "${tmp}" 2>/dev/null || true
}

main() {
	parse_args "$@"

	if ! command -v aws >/dev/null 2>&1; then
		log_error "aws CLI is required."
		exit 1
	fi

	local manifest
	manifest="$(load_manifest)"
	log "Loaded manifest: ${MANIFEST_PATH}"
	manifest_field "${manifest}"

	local status backup_id pb_key env_key pb_sha env_sha manifest_key
	status="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["status"])' "${manifest}")"
	backup_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["backup_id"])' "${manifest}")"
	pb_key="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archives"]["pb_data"]["s3_key"])' "${manifest}")"
	env_key="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archives"]["env"]["s3_key"])' "${manifest}")"
	pb_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archives"]["pb_data"]["sha256"])' "${manifest}")"
	env_sha="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["archives"]["env"]["sha256"])' "${manifest}")"

	if [[ "${status}" != 'complete' ]]; then
		log_error "Manifest status is '${status}', expected 'complete'."
		exit 1
	fi

	for key in "${pb_key}" "${env_key}"; do
		if s3_object_present "${key}"; then
			log "PASS: s3://${S3_BUCKET}/${key} exists"
		else
			log_error "FAIL: missing s3://${S3_BUCKET}/${key}"
			exit 1
		fi
	done

	verify_checksum_if_downloaded "${pb_key}" "${pb_sha}"
	verify_checksum_if_downloaded "${env_key}" "${env_sha}"

	log "Manifest verification PASSED for backup_id=${backup_id}"
}

main "$@"
