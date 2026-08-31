#!/usr/bin/env bash
set -euo pipefail

ROOT="${DOCMEE_ROOT:-/var/www/docmee}"
NODE_BIN="${NODE_BIN:-/home/ubuntu/.nvm/versions/node/v22.23.1/bin}"

export PATH="$NODE_BIN:$PATH"

cd "$ROOT"
"$ROOT/scripts/build-inboxos-safe.sh"
sudo systemctl restart docmee.service
sleep 5
"$ROOT/scripts/live-regression-check.sh"

echo "Safe InboxOS deployment completed."
