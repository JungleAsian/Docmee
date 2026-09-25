#!/usr/bin/env bash
set -euo pipefail

ROOT="${DOCMEE_ROOT:-/var/www/docmee}"
NODE_BIN="${NODE_BIN:-/home/ubuntu/.nvm/versions/node/v22.23.1/bin}"
INBOXOS_DIR="$ROOT/apps/inboxos"
CURRENT_DIR="$INBOXOS_DIR/.next"
ROLLBACK_DIR="$INBOXOS_DIR/.next-rollback"

export PATH="$NODE_BIN:$PATH"

cd "$ROOT"
"$ROOT/scripts/build-inboxos-safe.sh"

rollback_runtime() {
  local failed_dir="$INBOXOS_DIR/.next-failed-$(date -u +%Y%m%d%H%M%S)-$$"
  echo "Deployment verification failed; restoring the previous InboxOS build." >&2
  if [[ -d "$ROLLBACK_DIR" ]]; then
    if [[ -d "$CURRENT_DIR" ]]; then
      mv -- "$CURRENT_DIR" "$failed_dir"
    fi
    mv -- "$ROLLBACK_DIR" "$CURRENT_DIR"
    sudo systemctl restart docmee.service
    sleep 5
    "$ROOT/scripts/live-regression-check.sh" || true
  fi
}

trap rollback_runtime ERR
sudo systemctl restart docmee.service
sleep 5
"$ROOT/scripts/live-regression-check.sh"
trap - ERR

if [[ -d "$ROLLBACK_DIR" ]]; then
  rm -rf -- "$ROLLBACK_DIR"
fi

echo "Safe InboxOS deployment completed."
