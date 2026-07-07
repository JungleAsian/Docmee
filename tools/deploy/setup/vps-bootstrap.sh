#!/usr/bin/env bash
# One-time Docmee VPS bootstrap — run as root on a fresh Ubuntu VPS:
#   ssh root@<your-vps> 'bash -s' < tools/deploy/setup/vps-bootstrap.sh
# Idempotent: safe to re-run. After GitHub access is granted it clones the repo;
# then create .env.production and use "Deploy to VPS" from the DevTool.
set -euo pipefail

DEPLOY_PATH="${VPS_DEPLOY_PATH:-/var/www/docmee}"
REPO_URL="${DEPLOY_REPO_URL:-git@github.com:JungleAsian/Creascent-Development.git}"
BRANCH="${GITHUB_BRANCH:-main}"

echo "==> Base packages (git, curl, ufw, caddy, redis)"
apt-get update -y
apt-get install -y curl git ufw caddy redis-server
systemctl enable --now redis-server || true

echo "==> Node 20 + pnpm (corepack) + pm2"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
corepack enable || true
command -v pm2 >/dev/null 2>&1 || npm install -g pm2

echo "==> Firewall (ssh, http, https)"
ufw allow 22 || true
ufw allow 80 || true
ufw allow 443 || true
ufw --force enable || true

echo "==> GitHub deploy key"
KEY="$HOME/.ssh/id_ed25519"
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
[ -f "$KEY" ] || ssh-keygen -t ed25519 -N "" -f "$KEY" -C "docmee-vps"
ssh-keyscan -t ed25519 github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true

if ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -T git@github.com 2>&1 | grep -q "successfully authenticated"; then
  echo "GitHub auth OK."
else
  echo
  echo "!!! ACTION NEEDED: add this PUBLIC KEY as a GitHub Deploy Key"
  echo "    (repo > Settings > Deploy keys > Add, read-only is fine):"
  echo "------------------------------------------------------------------"
  cat "$KEY.pub"
  echo "------------------------------------------------------------------"
  echo "Then re-run this script to finish cloning."
  exit 0
fi

echo "==> Clone / update repo at $DEPLOY_PATH"
mkdir -p "$(dirname "$DEPLOY_PATH")"
[ -d "$DEPLOY_PATH/.git" ] || git clone "$REPO_URL" "$DEPLOY_PATH"
cd "$DEPLOY_PATH"
git fetch --all --prune
git reset --hard "origin/$BRANCH"

echo "==> Caddy reverse proxy (/api/* -> API :3001 stripped, else -> inboxos :3000)"
install -m 0644 "$DEPLOY_PATH/tools/deploy/Caddyfile.template" /etc/caddy/Caddyfile
systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true

echo "==> PM2 start on boot"
pm2 startup systemd -u "$(whoami)" --hp "$HOME" >/dev/null 2>&1 || true

echo
echo "==> Bootstrap complete."
echo "    Next: create $DEPLOY_PATH/.env.production with the app secrets,"
echo "    then click 'Deploy to VPS' in the DevTool (it builds, migrates, pm2-reloads, health-checks)."
