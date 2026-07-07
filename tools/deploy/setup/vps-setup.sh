#!/usr/bin/env bash
set -euo pipefail

apt-get update
apt-get install -y curl git ufw caddy
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
corepack enable
npm install -g pm2
ufw allow 22
ufw allow 80
ufw allow 443
ufw --force enable
