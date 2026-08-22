#!/usr/bin/env bash
# Build Seodeva API/Web images with immutable Git-SHA tags + OCI labels.
# Does NOT deploy, push, or touch running compose services.
#
# Usage (from repo root):
#   ./deploy/scripts/build-images-with-sha.sh
#   ./deploy/scripts/build-images-with-sha.sh --also-latest
#   GIT_SHA=deadbeef ./deploy/scripts/build-images-with-sha.sh api
#   ./deploy/scripts/build-images-with-sha.sh web
#
# Images:
#   seodeva-api:<GIT_SHA>   seodeva-web:<GIT_SHA>
# Optional: also tag :latest (local alias only; does not push).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

ALSO_LATEST=0
TARGETS=()

while [[ $# -gt 0 ]]; do
	case "$1" in
		--also-latest) ALSO_LATEST=1; shift ;;
		api|web) TARGETS+=("$1"); shift ;;
		-h|--help)
			sed -n '1,20p' "$0"
			exit 0
			;;
		*)
			echo "Unknown argument: $1" >&2
			exit 1
			;;
	esac
done

if [[ ${#TARGETS[@]} -eq 0 ]]; then
	TARGETS=(api web)
fi

GIT_SHA="${GIT_SHA:-$(git rev-parse HEAD)}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

echo "GIT_SHA=${GIT_SHA}"
echo "BUILD_DATE=${BUILD_DATE}"

build_api() {
	local tags=(-t "seodeva-api:${GIT_SHA}")
	if [[ "$ALSO_LATEST" -eq 1 ]]; then
		tags+=(-t seodeva-api:latest)
	fi
	docker build \
		-f Dockerfile.api \
		--build-arg "GIT_SHA=${GIT_SHA}" \
		--build-arg "BUILD_DATE=${BUILD_DATE}" \
		"${tags[@]}" \
		.
}

build_web() {
	local tags=(-t "seodeva-web:${GIT_SHA}")
	if [[ "$ALSO_LATEST" -eq 1 ]]; then
		tags+=(-t seodeva-web:latest)
	fi
	docker build \
		-f Dockerfile.web \
		--build-arg "GIT_SHA=${GIT_SHA}" \
		--build-arg "BUILD_DATE=${BUILD_DATE}" \
		--build-arg "VITE_PADDLE_CLIENT_TOKEN=${VITE_PADDLE_CLIENT_TOKEN:-}" \
		"${tags[@]}" \
		.
}

for t in "${TARGETS[@]}"; do
	case "$t" in
		api) build_api ;;
		web) build_web ;;
	esac
done

echo
echo "Built tags:"
for t in "${TARGETS[@]}"; do
	echo "  seodeva-${t}:${GIT_SHA}"
	if [[ "$ALSO_LATEST" -eq 1 ]]; then
		echo "  seodeva-${t}:latest"
	fi
done

echo
echo "Verify labels (example):"
echo "  docker inspect seodeva-api:${GIT_SHA} --format '{{ index .Config.Labels \"org.opencontainers.image.revision\" }}'"
