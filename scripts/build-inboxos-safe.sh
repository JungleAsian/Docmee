#!/usr/bin/env bash
set -euo pipefail

ROOT="${DOCMEE_ROOT:-/var/www/docmee}"
NODE_BIN="${NODE_BIN:-/home/ubuntu/.nvm/versions/node/v22.23.1/bin}"
LOCK_FILE="${LOCK_FILE:-/tmp/docmee-inboxos-build.lock}"
LOG_FILE="${LOG_FILE:-/tmp/docmee-inboxos-build-safe.log}"

export PATH="$NODE_BIN:$PATH"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another Docmee InboxOS build is already running. Refusing to start a second build." >&2
  exit 75
fi

cd "$ROOT"
echo "Building Docmee runtime from $ROOT"
echo "Log: $LOG_FILE"
# The deployment restarts the entire service, including API and workers.
# Rebuild their transitive dependencies so new source exports are available.
pnpm --filter @docmee/workers... --filter @docmee/api... build 2>&1 | tee "$LOG_FILE"
pnpm --filter @docmee/inboxos build 2>&1 | tee -a "$LOG_FILE"

"$ROOT/scripts/live-regression-check.sh" --source-only
