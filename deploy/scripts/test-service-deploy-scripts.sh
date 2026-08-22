#!/usr/bin/env bash
# Static validation for Phase 3 service-scoped deploy scripts.
# Does NOT deploy, build images, or touch running containers.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail=0

pass() { echo "PASS: $*"; }
fail_msg() { echo "FAIL: $*" >&2; fail=1; }

WEB=deploy/scripts/deploy-web.sh
API=deploy/scripts/deploy-api.sh
COMMON=deploy/scripts/lib/deploy-common.sh

test -x "$WEB" && pass "web executable bit" || fail_msg "web executable bit"
test -x "$API" && pass "api executable bit" || fail_msg "api executable bit"
bash -n "$WEB" && pass "bash -n web" || fail_msg "bash -n web"
bash -n "$API" && pass "bash -n api" || fail_msg "bash -n api"
bash -n "$COMMON" && pass "bash -n common" || fail_msg "bash -n common"

grep -q -- '--no-deps' "$WEB" && pass "web uses --no-deps" || fail_msg "web uses --no-deps"
grep -q -- '--no-deps' "$API" && pass "api uses --no-deps" || fail_msg "api uses --no-deps"
grep -Eq -- 'up -d --no-deps --force-recreate web' "$WEB" && pass "web force-recreate web only" || fail_msg "web force-recreate web only"
grep -Eq -- 'up -d --no-deps --force-recreate api' "$API" && pass "api force-recreate api only" || fail_msg "api force-recreate api only"

if grep -Eq -- 'force-recreate api|up -d --build' "$WEB"; then
	fail_msg "web must not recreate api / full --build"
else
	pass "web does not recreate api / full --build"
fi
if grep -Eq -- 'force-recreate web|up -d --build' "$API"; then
	fail_msg "api must not recreate web / full --build"
else
	pass "api does not recreate web / full --build"
fi

grep -q 'ALLOW_DIRTY_WORKTREE' "$COMMON" && pass "dirty-tree guard present" || fail_msg "dirty-tree guard present"
grep -q 'CONFIRM_PRODUCTION' "$COMMON" && pass "production confirm present" || fail_msg "production confirm present"
grep -q 'DRY_RUN' "$COMMON" && pass "dry-run present" || fail_msg "dry-run present"
grep -q 'build-images-with-sha.sh' "$COMMON" && pass "uses Phase 2 builder" || fail_msg "uses Phase 2 builder"

for needle in 'git[[:space:]]\+reset' 'git[[:space:]]\+stash' 'git[[:space:]]\+commit' 'git[[:space:]]\+push' 'compose[[:space:]].*down' 'systemctl' 'nginx[[:space:]]\+-s' 'nginx[[:space:]]\+reload'; do
	if grep -En "$needle" "$WEB" "$API" "$COMMON" >/dev/null 2>&1; then
		fail_msg "forbidden pattern found: $needle"
	else
		pass "no forbidden pattern: $needle"
	fi
done

if bash -c '
  set -euo pipefail
  source deploy/scripts/lib/deploy-common.sh
  ALLOW_DIRTY_WORKTREE=0
  set +e
  require_clean_worktree >/tmp/phase3-guard.out 2>&1
  ec=$?
  set -e
  if git status --porcelain | grep -q .; then
    test "$ec" -ne 0
  else
    test "$ec" -eq 0
  fi
'; then
	pass "dirty guard refuses without override"
else
	fail_msg "dirty guard refuses without override"
	tail -5 /tmp/phase3-guard.out >&2 || true
fi

if env DRY_RUN=1 ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES bash "$WEB" >/tmp/phase3-dry-web.out 2>&1; then
	pass "dry-run web exits 0 without mutate"
else
	fail_msg "dry-run web exits 0 without mutate"
	tail -20 /tmp/phase3-dry-web.out >&2 || true
fi

if env DRY_RUN=1 ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES bash "$API" >/tmp/phase3-dry-api.out 2>&1; then
	pass "dry-run api exits 0 without mutate"
else
	fail_msg "dry-run api exits 0 without mutate"
	tail -20 /tmp/phase3-dry-api.out >&2 || true
fi

# Confirm dry-run never issued a real compose up (log only)
if grep -E '^\+ docker compose|DRY_RUN: docker compose' /tmp/phase3-dry-web.out /tmp/phase3-dry-api.out | grep -v DRY_RUN >/dev/null 2>&1; then
	fail_msg "dry-run must not run real compose up"
else
	pass "dry-run did not run real compose up"
fi

if [[ "$fail" -ne 0 ]]; then
	echo "Static validation FAILED" >&2
	exit 1
fi
echo "Static validation PASSED"
