#!/usr/bin/env bash
# Static + dry-run validation for Phase 3/4 service-scoped deploy & rollback.
# Does NOT deploy, build production images, or touch running containers beyond read-only inspect.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

fail=0
pass() { echo "PASS: $*"; }
fail_msg() { echo "FAIL: $*" >&2; fail=1; }

WEB=deploy/scripts/deploy-web.sh
API=deploy/scripts/deploy-api.sh
RWEB=deploy/scripts/rollback-web.sh
RAPI=deploy/scripts/rollback-api.sh
COMMON=deploy/scripts/lib/deploy-common.sh

for f in "$WEB" "$API" "$RWEB" "$RAPI"; do
	test -x "$f" && pass "executable $f" || fail_msg "executable $f"
	bash -n "$f" && pass "bash -n $f" || fail_msg "bash -n $f"
done
bash -n "$COMMON" && pass "bash -n common" || fail_msg "bash -n common"

grep -q -- '--no-deps' "$WEB" && pass "web deploy --no-deps" || fail_msg "web deploy --no-deps"
grep -q -- '--no-deps' "$API" && pass "api deploy --no-deps" || fail_msg "api deploy --no-deps"
grep -q -- '--no-deps' "$RWEB" && pass "web rollback --no-deps" || fail_msg "web rollback --no-deps"
grep -q -- '--no-deps' "$RAPI" && pass "api rollback --no-deps" || fail_msg "api rollback --no-deps"

grep -Eq -- 'up -d --no-deps --force-recreate web' "$WEB" && pass "web deploy target" || fail_msg "web deploy target"
grep -Eq -- 'up -d --no-deps --force-recreate api' "$API" && pass "api deploy target" || fail_msg "api deploy target"
grep -Eq -- 'up -d --no-deps --force-recreate web' "$RWEB" && pass "web rollback target" || fail_msg "web rollback target"
grep -Eq -- 'up -d --no-deps --force-recreate api' "$RAPI" && pass "api rollback target" || fail_msg "api rollback target"

for f in "$WEB" "$API" "$RWEB" "$RAPI" "$COMMON"; do
	if grep -Eq -- '--build' "$f"; then
		fail_msg "--build forbidden in $f"
	else
		pass "no --build in $f"
	fi
	# Ignore comment lines when scanning for dangerous compose down
	if grep -En '^[[:space:]]*[^#[:space:]].*compose[[:space:]].*down|^[[:space:]]*docker[[:space:]]+compose[[:space:]]+down' "$f" >/dev/null 2>&1; then
		fail_msg "compose down forbidden in $f"
	else
		pass "no compose down in $f"
	fi
	if grep -En '^[[:space:]]*[^#[:space:]].*git[[:space:]]+reset|^[[:space:]]*[^#[:space:]].*git[[:space:]]+checkout' "$f" >/dev/null 2>&1; then
		fail_msg "git reset/checkout forbidden in $f"
	else
		pass "no git reset/checkout in $f"
	fi
done

grep -q 'ALLOW_DIRTY_WORKTREE' "$COMMON" && pass "dirty-tree guard present" || fail_msg "dirty-tree guard present"
grep -q 'CONFIRM_PRODUCTION' "$COMMON" && pass "production confirm present" || fail_msg "production confirm present"
grep -q 'AUTO_ROLLBACK' "$COMMON" && pass "AUTO_ROLLBACK present" || fail_msg "AUTO_ROLLBACK present"
grep -q 'AUTO_ROLLBACK' "$WEB" && pass "web mentions AUTO_ROLLBACK" || fail_msg "web mentions AUTO_ROLLBACK"
grep -q 'last-web-deploy.json\|state_file_for\|DEPLOY_STATE_DIR\|atomic_write_deploy_state' "$COMMON" && pass "state helpers present" || fail_msg "state helpers present"
grep -q 'seodeva-.*:previous\|previous_retention_tag' "$COMMON" && pass "previous retention tag present" || fail_msg "previous retention tag present"
grep -q 'resolve_previous_image_id' "$COMMON" && pass "resolve_previous_image_id present" || fail_msg "resolve_previous_image_id present"

# Rollback must NOT call require_clean_worktree (comments mentioning it are OK)
if grep -En '^[[:space:]]*require_clean_worktree' "$RWEB" "$RAPI" >/dev/null 2>&1; then
	fail_msg "rollback must not require_clean_worktree"
else
	pass "rollback does not require clean worktree"
fi

# Rollback requires production confirmation
grep -q 'require_production_confirm' "$RWEB" && pass "rollback-web requires confirm" || fail_msg "rollback-web requires confirm"
grep -q 'require_production_confirm' "$RAPI" && pass "rollback-api requires confirm" || fail_msg "rollback-api requires confirm"

# AUTO_ROLLBACK default off (opt-in)
grep -q 'AUTO_ROLLBACK:-0\|AUTO_ROLLBACK:-""\|AUTO_ROLLBACK="\${AUTO_ROLLBACK:-0}"' "$COMMON" && pass "AUTO_ROLLBACK defaults off" || fail_msg "AUTO_ROLLBACK defaults off"

# .gitignore covers state json
grep -q 'deploy/state/\*\.json' .gitignore && pass "gitignore state json" || fail_msg "gitignore state json"
test -f deploy/state/.gitkeep && pass "state .gitkeep exists" || fail_msg "state .gitkeep exists"

# Dirty guard still works for deploy
if bash -c '
  set -euo pipefail
  source deploy/scripts/lib/deploy-common.sh
  ALLOW_DIRTY_WORKTREE=0
  set +e
  require_clean_worktree >/tmp/phase4-guard.out 2>&1
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
fi

# Missing image ID rejection
if bash -c '
  set -euo pipefail
  source deploy/scripts/lib/deploy-common.sh
  DRY_RUN=0
  if verify_image_id_exists "sha256:000000000000000000000000000000000000000000000000000000000000dead"; then
    exit 1
  fi
  exit 0
'; then
	pass "missing image ID rejected"
else
	fail_msg "missing image ID rejected"
fi

# Explicit PREVIOUS_IMAGE_ID resolution
if bash -c '
  set -euo pipefail
  source deploy/scripts/lib/deploy-common.sh
  PREVIOUS_IMAGE_ID="sha256:abc123explicit"
  out="$(resolve_previous_image_id web)"
  [[ "$out" == "sha256:abc123explicit|explicit:PREVIOUS_IMAGE_ID" ]]
'; then
	pass "explicit PREVIOUS_IMAGE_ID resolution"
else
	fail_msg "explicit PREVIOUS_IMAGE_ID resolution"
fi

# State-file resolution
mkdir -p deploy/state
cat > deploy/state/last-web-deploy.json <<'EOF'
{
  "service": "web",
  "status": "failed",
  "previous_image_id": "sha256:fromstatefile0000000000000000000000000001"
}
EOF
if bash -c '
  set -euo pipefail
  source deploy/scripts/lib/deploy-common.sh
  unset PREVIOUS_IMAGE_ID || true
  PREVIOUS_IMAGE_ID=""
  out="$(resolve_previous_image_id web)"
  [[ "$out" == sha256:fromstatefile0000000000000000000000000001\|state:* ]]
'; then
	pass "state-file resolution"
else
	fail_msg "state-file resolution"
fi
rm -f deploy/state/last-web-deploy.json

# Previous-tag resolution (if tag exists use it; else ensure function fails without explicit/state)
if docker image inspect seodeva-web:previous >/dev/null 2>&1; then
	if bash -c '
	  set -euo pipefail
	  source deploy/scripts/lib/deploy-common.sh
	  unset PREVIOUS_IMAGE_ID || true
	  PREVIOUS_IMAGE_ID=""
	  rm -f deploy/state/last-web-deploy.json
	  out="$(resolve_previous_image_id web)"
	  [[ "$out" == *"|tag:seodeva-web:previous" ]]
	'; then
		pass "previous-tag resolution"
	else
		fail_msg "previous-tag resolution"
	fi
else
	if bash -c '
	  set -euo pipefail
	  source deploy/scripts/lib/deploy-common.sh
	  unset PREVIOUS_IMAGE_ID || true
	  PREVIOUS_IMAGE_ID=""
	  rm -f deploy/state/last-web-deploy.json
	  set +e
	  resolve_previous_image_id web >/dev/null 2>&1
	  ec=$?
	  set -e
	  test "$ec" -ne 0
	'; then
		pass "previous-tag missing fails closed"
	else
		fail_msg "previous-tag missing fails closed"
	fi
fi

# Dry-run deploy (no mutate)
if env DRY_RUN=1 ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES bash "$WEB" >/tmp/phase4-dry-web.out 2>&1; then
	pass "dry-run web deploy"
else
	fail_msg "dry-run web deploy"
	tail -30 /tmp/phase4-dry-web.out >&2 || true
fi
if env DRY_RUN=1 ALLOW_DIRTY_WORKTREE=1 CONFIRM_PRODUCTION=YES bash "$API" >/tmp/phase4-dry-api.out 2>&1; then
	pass "dry-run api deploy"
else
	fail_msg "dry-run api deploy"
	tail -30 /tmp/phase4-dry-api.out >&2 || true
fi

# Dry-run rollback with explicit ID (no mutate)
if env DRY_RUN=1 CONFIRM_PRODUCTION=YES PREVIOUS_IMAGE_ID=sha256:deadbeefdryrun000000000000000000000001 \
	bash "$RWEB" >/tmp/phase4-dry-rweb.out 2>&1; then
	pass "dry-run web rollback"
	grep -q 'no-deps --force-recreate web' /tmp/phase4-dry-rweb.out && pass "dry-run web shows compose recreate" || fail_msg "dry-run web shows compose recreate"
	grep -q '\-\-build' /tmp/phase4-dry-rweb.out && fail_msg "dry-run web must not mention --build" || pass "dry-run web no --build"
else
	fail_msg "dry-run web rollback"
	tail -30 /tmp/phase4-dry-rweb.out >&2 || true
fi

if env DRY_RUN=1 CONFIRM_PRODUCTION=YES PREVIOUS_IMAGE_ID=sha256:deadbeefdryrun000000000000000000000002 \
	bash "$RAPI" >/tmp/phase4-dry-rapi.out 2>&1; then
	pass "dry-run api rollback"
	grep -q 'no-deps --force-recreate api' /tmp/phase4-dry-rapi.out && pass "dry-run api shows compose recreate" || fail_msg "dry-run api shows compose recreate"
else
	fail_msg "dry-run api rollback"
	tail -30 /tmp/phase4-dry-rapi.out >&2 || true
fi

# Ensure dry-run did not run real compose up (only DRY_RUN lines)
if grep -E '^\+ docker compose' /tmp/phase4-dry-web.out /tmp/phase4-dry-api.out /tmp/phase4-dry-rweb.out /tmp/phase4-dry-rapi.out 2>/dev/null | grep -v DRY_RUN >/dev/null 2>&1; then
	fail_msg "dry-run must not run real compose up"
else
	pass "dry-run did not run real compose up"
fi

# oracle-rollback still present but documented unsafe in SERVICE-DEPLOY
grep -q 'oracle-rollback.sh' deploy/SERVICE-DEPLOY.md && grep -qi 'UNSAFE' deploy/SERVICE-DEPLOY.md \
	&& pass "oracle-rollback marked unsafe in docs" || fail_msg "oracle-rollback marked unsafe in docs"
test -f deploy/scripts/oracle-rollback.sh && pass "oracle-rollback.sh retained" || fail_msg "oracle-rollback.sh retained"

if [[ "$fail" -ne 0 ]]; then
	echo "Static validation FAILED" >&2
	exit 1
fi
echo "Static validation PASSED"
