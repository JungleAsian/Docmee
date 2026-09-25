#!/usr/bin/env bash
set -euo pipefail

ROOT="${DOCMEE_ROOT:-/var/www/docmee}"
NODE_BIN="${NODE_BIN:-/home/ubuntu/.nvm/versions/node/v22.23.1/bin}"
LOCK_FILE="${LOCK_FILE:-/tmp/docmee-inboxos-build.lock}"
LOG_FILE="${LOG_FILE:-/tmp/docmee-inboxos-build-safe.log}"
INBOXOS_DIR="$ROOT/apps/inboxos"
CURRENT_DIR="$INBOXOS_DIR/.next"
ROLLBACK_DIR="$INBOXOS_DIR/.next-rollback"
RELEASE_DIR_NAME="${NEXT_RELEASE_DIR_NAME:-.next-release-$(date -u +%Y%m%d%H%M%S)-$$}"
RELEASE_DIR="$INBOXOS_DIR/$RELEASE_DIR_NAME"
CONFIG_BACKUP_DIR=""

export PATH="$NODE_BIN:$PATH"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another Docmee InboxOS build is already running. Refusing to start a second build." >&2
  exit 75
fi

cd "$ROOT"
echo "Building Docmee runtime from $ROOT"
echo "Log: $LOG_FILE"

case "$RELEASE_DIR_NAME" in
  .next-release-*) ;;
  *)
    echo "NEXT_RELEASE_DIR_NAME must start with .next-release-" >&2
    exit 64
    ;;
esac

if [[ -e "$RELEASE_DIR" ]]; then
  echo "Release build directory already exists: $RELEASE_DIR" >&2
  exit 73
fi

cleanup_build() {
  local status=$?
  if [[ -n "$CONFIG_BACKUP_DIR" && -d "$CONFIG_BACKUP_DIR" ]]; then
    cp -p -- "$CONFIG_BACKUP_DIR/next-env.d.ts" "$INBOXOS_DIR/next-env.d.ts"
    cp -p -- "$CONFIG_BACKUP_DIR/tsconfig.json" "$INBOXOS_DIR/tsconfig.json"
    rm -rf -- "$CONFIG_BACKUP_DIR"
  fi
  if [[ $status -ne 0 && -d "$RELEASE_DIR" ]]; then
    rm -rf -- "$RELEASE_DIR"
  fi
  return "$status"
}
trap cleanup_build EXIT

# Next rewrites these tracked files when a non-default distDir is used. Keep the
# source checkout clean while still building into an isolated release folder.
CONFIG_BACKUP_DIR="$(mktemp -d /tmp/docmee-inboxos-config.XXXXXX)"
cp -p -- "$INBOXOS_DIR/next-env.d.ts" "$CONFIG_BACKUP_DIR/next-env.d.ts"
cp -p -- "$INBOXOS_DIR/tsconfig.json" "$CONFIG_BACKUP_DIR/tsconfig.json"

# The deployment restarts the entire service, including API and workers.
# Rebuild their transitive dependencies so new source exports are available.
pnpm --filter @docmee/workers... --filter @docmee/api... build 2>&1 | tee "$LOG_FILE"
NEXT_DIST_DIR="$RELEASE_DIR_NAME" pnpm --filter @docmee/inboxos build 2>&1 | tee -a "$LOG_FILE"

# Keep assets from the currently served build so already-open browser tabs can
# finish loading their old hashed chunks after the release is activated.
if [[ -d "$CURRENT_DIR/static" ]]; then
  mkdir -p "$RELEASE_DIR/static"
  cp -an "$CURRENT_DIR/static/." "$RELEASE_DIR/static/"
fi

NEXT_BUILD_DIR="$RELEASE_DIR" "$ROOT/scripts/live-regression-check.sh" --source-only

# Activate the complete build with two same-filesystem renames. The live server
# never observes the partially written output produced by `next build`.
if [[ -d "$ROLLBACK_DIR" ]]; then
  rm -rf -- "$ROLLBACK_DIR"
fi
if [[ -d "$CURRENT_DIR" ]]; then
  mv -- "$CURRENT_DIR" "$ROLLBACK_DIR"
fi
if ! mv -- "$RELEASE_DIR" "$CURRENT_DIR"; then
  if [[ -d "$ROLLBACK_DIR" && ! -e "$CURRENT_DIR" ]]; then
    mv -- "$ROLLBACK_DIR" "$CURRENT_DIR"
  fi
  exit 1
fi

echo "Prepared and activated InboxOS build at $CURRENT_DIR"
