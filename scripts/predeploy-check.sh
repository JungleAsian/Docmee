#!/usr/bin/env bash
# READ-ONLY pre-deploy gate. Run on the server, as the runtime user (not root),
# BEFORE scripts/deploy-inboxos-safe.sh:
#
#   scripts/predeploy-check.sh <target-commit-sha> [--fetch] [--skip-live] [--skip-db]
#
#   --fetch      git fetch origin first (updates .git objects only; never touches
#                the working tree). Needed if the target is not already local.
#   --skip-live  skip service / health-endpoint checks (local testing).
#   --skip-db    skip the migration comparison (local testing).
#
# It changes nothing: no checkout, no build, no migrations, no restarts. Output
# is limited to commit ids, file names, counts and the health response's ok /
# buildId fields — never environment values, credentials or database rows.
# Exit status is non-zero if any check FAILS; WARN needs a human look.
set -uo pipefail

ROOT="${DOCMEE_ROOT:-/var/www/docmee}"
NODE_BIN="${NODE_BIN:-/home/ubuntu/.nvm/versions/node/v22.23.1/bin}"
APP_URL="${APP_URL:-https://app.docmeedevelopment.dev}"
LOCAL_HEALTH_URL="${LOCAL_HEALTH_URL:-http://127.0.0.1:3001/health}"
MIN_FREE_KB_FAIL=$((1500 * 1024))
MIN_FREE_KB_WARN=$((3000 * 1024))
export PATH="$NODE_BIN:$PATH"

TARGET_INPUT=""
DO_FETCH=false
SKIP_LIVE=false
SKIP_DB=false
for arg in "$@"; do
  case "$arg" in
    --fetch) DO_FETCH=true ;;
    --skip-live) SKIP_LIVE=true ;;
    --skip-db) SKIP_DB=true ;;
    -*) echo "Unknown option: $arg" >&2; exit 64 ;;
    *) TARGET_INPUT="$arg" ;;
  esac
done
if [[ -z "$TARGET_INPUT" || ! "$TARGET_INPUT" =~ ^[0-9a-fA-F]{7,40}$ ]]; then
  echo "Usage: $0 <target-commit-sha> [--fetch] [--skip-live] [--skip-db]" >&2
  exit 64
fi

pass_count=0; warn_count=0; fail_count=0
pass() { echo "PASS  $*"; pass_count=$((pass_count + 1)); }
warn() { echo "WARN  $*"; warn_count=$((warn_count + 1)); }
fail() { echo "FAIL  $*"; fail_count=$((fail_count + 1)); }
info() { echo "      $*"; }
section() { echo; echo "== $* =="; }

g() { git -C "$ROOT" "$@"; }

section "Runtime identity"
if [[ "$(id -u)" -eq 0 ]]; then
  fail "running as root; run as the runtime user (ubuntu)"
else
  pass "running as non-root user $(id -un)"
fi
[[ -d "$ROOT/.git" ]] && pass "checkout found at $ROOT" || { fail "no git checkout at $ROOT"; echo; echo "RESULT: FAIL"; exit 1; }

section "Checkout state"
HEAD_SHA="$(g rev-parse HEAD)"
info "current commit: $HEAD_SHA ($(g rev-parse --abbrev-ref HEAD))"
tracked_dirty="$(g status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
untracked="$(g status --porcelain | grep -c '^??' || true)"
if [[ "$tracked_dirty" -gt 0 ]]; then
  fail "$tracked_dirty tracked file(s) modified on the server; a deploy could overwrite or conflict with them"
  g status --porcelain --untracked-files=no | head -10 | sed 's/^/        /'
else
  pass "no modified tracked files"
fi
[[ "$untracked" -gt 0 ]] && warn "$untracked untracked file(s) present (not a blocker)"

section "Target revision"
if $DO_FETCH; then
  if g fetch --quiet origin 2>/dev/null; then pass "fetched origin"; else warn "git fetch origin failed; using local objects only"; fi
fi
if ! TARGET="$(g rev-parse --verify --quiet "${TARGET_INPUT}^{commit}")"; then
  fail "target $TARGET_INPUT is not in this checkout (re-run with --fetch)"
  echo; echo "RESULT: FAIL ($fail_count failed)"; exit 1
fi
info "target commit:  $TARGET"
if [[ "$TARGET" == "$HEAD_SHA" ]]; then
  warn "target equals the current commit; nothing new to deploy"
elif g merge-base --is-ancestor "$HEAD_SHA" "$TARGET"; then
  pass "clean fast-forward: target is $(g rev-list --count "$HEAD_SHA..$TARGET") commit(s) ahead of current"
elif g merge-base --is-ancestor "$TARGET" "$HEAD_SHA"; then
  fail "target is OLDER than the current commit; deploying it would roll code back"
else
  fail "target and current commit have diverged; work on one side would be lost"
fi

section "What the update touches"
changed="$(g diff --name-only "$HEAD_SHA" "$TARGET" 2>/dev/null | wc -l | tr -d ' ')"
info "$changed file(s) differ between current and target"
risky="$(g diff --name-only "$HEAD_SHA" "$TARGET" 2>/dev/null | grep -E '^(\.env|ecosystem\.config\.cjs|Caddyfile|scripts/(deploy|build|live-regression|predeploy)|\.github/)' || true)"
if [[ -n "$risky" ]]; then warn "deployment or runtime configuration files change:"; echo "$risky" | sed 's/^/        /'; else pass "no deployment or runtime configuration files change"; fi
if g diff --name-only "$HEAD_SHA" "$TARGET" 2>/dev/null | grep -qE '(^|/)pnpm-lock\.yaml$'; then
  warn "dependencies change (pnpm-lock.yaml). The safe deploy script does NOT run pnpm install; run 'pnpm install --frozen-lockfile' first or the build can fail"
else
  pass "no dependency changes"
fi

section "Database migrations"
if $SKIP_DB; then
  info "skipped (--skip-db)"
elif [[ ! -f "$ROOT/.env.production" ]]; then
  fail "$ROOT/.env.production not found; cannot read the database"
else
  stage="$(mktemp -d /tmp/docmee-predeploy.XXXXXX)"
  trap 'rm -rf -- "$stage"' EXIT
  mkdir -p "$stage/packages/db"
  if g archive "$TARGET" packages/db/scripts/pending-migrations.ts packages/db/src/migration-plan.ts 2>/dev/null | tar -x -C "$stage"; then
    ln -s "$ROOT/packages/db/node_modules" "$stage/packages/db/node_modules"
    migration_out="$( (set -a; . "$ROOT/.env.production"; set +a; DOCMEE_REPO_ROOT="$ROOT" "$ROOT/packages/db/node_modules/.bin/tsx" "$stage/packages/db/scripts/pending-migrations.ts" --ref "$TARGET") 2>&1 )"
    migration_rc=$?
    echo "$migration_out" | sed 's/^/      /'
    case "$migration_rc" in
      0) pass "migration comparison finished with nothing blocking" ;;
      2) fail "migration comparison needs a human decision (see above)" ;;
      *) fail "migration comparison errored (exit $migration_rc)" ;;
    esac
    if echo "$migration_out" | grep -qE 'pending migration\(s\) would be applied'; then
      warn "MANUAL GATE: take an RDS snapshot, then apply these migrations BEFORE the code deploy"
    fi
  else
    fail "target revision has no migration screener (packages/db/scripts/pending-migrations.ts); deploy a revision that includes it"
  fi
fi

section "Services and health"
if $SKIP_LIVE; then
  info "skipped (--skip-live)"
else
  for unit in docmee.service caddy; do
    systemctl is-active --quiet "$unit" && pass "$unit is active" || fail "$unit is not active"
  done
  local_body="$(curl -fsS -m 8 "$LOCAL_HEALTH_URL" 2>/dev/null || true)"
  if echo "$local_body" | grep -q '"ok":true'; then
    local_build="$(echo "$local_body" | grep -oE '"buildId":"[^"]*"' | head -1)"
    pass "local API health ok ${local_build}"
  else
    fail "local API health check failed at $LOCAL_HEALTH_URL"
  fi
  public_body="$(curl -fsS -m 10 "$APP_URL/api/health" 2>/dev/null || true)"
  if echo "$public_body" | grep -q '"ok":true'; then
    pass "public health ok at $APP_URL/api/health"
  else
    fail "public health check failed at $APP_URL/api/health"
  fi
  curl -fsS -m 10 "$APP_URL/login" >/dev/null 2>&1 && pass "login page reachable" || fail "login page not reachable"
fi

section "Rollback readiness"
info "rollback point (current commit): $HEAD_SHA"
if [[ -f "$ROOT/apps/inboxos/.next/BUILD_ID" ]]; then pass "current InboxOS build present (the safe deploy keeps it as .next-rollback)"; else fail "no current InboxOS build at apps/inboxos/.next; nothing to roll back to"; fi
[[ -d "$ROOT/apps/inboxos/.next-rollback" ]] && warn "a previous .next-rollback folder exists; the next build will delete it"
if pgrep -f build-inboxos-safe >/dev/null 2>&1; then fail "another InboxOS build is already running"; else pass "no build in progress"; fi
free_kb="$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')"
if [[ "$free_kb" -lt "$MIN_FREE_KB_FAIL" ]]; then fail "only $((free_kb / 1024)) MB free; a build needs room for a second copy"; \
elif [[ "$free_kb" -lt "$MIN_FREE_KB_WARN" ]]; then warn "$((free_kb / 1024)) MB free; getting tight for a second build"; \
else pass "$((free_kb / 1024)) MB free disk"; fi
command -v pnpm >/dev/null 2>&1 && pass "pnpm available" || fail "pnpm not found on PATH ($NODE_BIN)"
info "NOT covered by the safe deploy's automatic rollback: API and workers (rebuilt in place) and any applied migration."
info "To roll those back: check out $HEAD_SHA, rebuild, restart docmee.service."

echo
echo "SUMMARY: $pass_count passed, $warn_count warning(s), $fail_count failed"
if [[ "$fail_count" -gt 0 ]]; then echo "RESULT: FAIL — do not deploy"; exit 1; fi
if [[ "$warn_count" -gt 0 ]]; then echo "RESULT: PASS WITH WARNINGS — review each warning before deploying"; exit 0; fi
echo "RESULT: PASS"
