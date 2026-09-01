#!/usr/bin/env bash
set -euo pipefail

ROOT="${DOCMEE_ROOT:-/var/www/docmee}"
APP_URL="${APP_URL:-https://app.docmeedevelopment.dev}"
CSS_FILE="$ROOT/apps/inboxos/src/app/globals.css"
ENV_FILE="$ROOT/.env.production"
NEXT_BUILD_ID="$ROOT/apps/inboxos/.next/BUILD_ID"
SIDEBAR_FILE="$ROOT/apps/inboxos/src/shared/components/Sidebar.tsx"
TUTORIAL_FILE="$ROOT/apps/inboxos/src/shared/components/InAppTutorial.tsx"
ADMIN_LAYOUT_FILE="$ROOT/apps/inboxos/src/app/(admin)/layout.tsx"
CLINIC_LAYOUT_FILE="$ROOT/apps/inboxos/src/app/(clinic)/layout.tsx"

source_only=false
if [[ "${1:-}" == "--source-only" ]]; then
  source_only=true
fi

fail() {
  echo "REGRESSION CHECK FAILED: $*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || fail "Missing required file: $1"
}

require_grep() {
  local pattern="$1"
  local file="$2"
  local label="$3"
  grep -Eq -- "$pattern" "$file" || fail "$label"
}

reject_grep() {
  local pattern="$1"
  local file="$2"
  local label="$3"
  if grep -Eq -- "$pattern" "$file"; then
    fail "$label"
  fi
}

require_file "$CSS_FILE"
require_file "$ENV_FILE"
require_file "$NEXT_BUILD_ID"
require_file "$SIDEBAR_FILE"
require_file "$TUTORIAL_FILE"
require_file "$ADMIN_LAYOUT_FILE"
require_file "$CLINIC_LAYOUT_FILE"

require_grep '^APP_URL=https://app\.docmeedevelopment\.dev$' "$ENV_FILE" "APP_URL must target app.docmeedevelopment.dev"
require_grep '^NEXT_PUBLIC_API_URL=https://app\.docmeedevelopment\.dev/api$' "$ENV_FILE" "NEXT_PUBLIC_API_URL must target app.docmeedevelopment.dev/api"
require_grep '^GOOGLE_REDIRECT_URI=https://app\.docmeedevelopment\.dev/api/clinic/calendar/callback$' "$ENV_FILE" "Google OAuth redirect must target app.docmeedevelopment.dev"

require_grep '--crm-primary-color: #247ea3;' "$CSS_FILE" "Light primary token must stay cyan/blue (#247ea3)"
require_grep '--crm-primary-color: #34c6e5;' "$CSS_FILE" "Dark primary token must stay bright cyan (#34c6e5)"
require_grep '--crm-active-bg: linear-gradient\(90deg, #247ea3 0%, #22c7dc 100%\);' "$CSS_FILE" "Active background must stay cyan/blue"
require_grep '\.docmee-page-hero' "$CSS_FILE" "Shared Docmee page-banner styles are missing"
require_grep '\.docmee-page-hero-icon' "$CSS_FILE" "Compact page-header icon styles are missing"
require_grep '\.docmee-page-hero-title-row' "$CSS_FILE" "Compact page-header title row styles are missing"
reject_grep 'background-image: var\(--docmee-page-hero-image\);' "$CSS_FILE" "Compact page headers must not reintroduce the mascot background hook"
require_grep "background-image: url\\('/mascot-banners/hologram'\\);" "$CSS_FILE" "Help Center must use transparent mascot route, not a flat banner image"
require_grep '\.docmee-help-hero::before' "$CSS_FILE" "Help Center transparent mascot layer is missing"
reject_grep "url\\('/brand/docmee-help-banner\\.png'\\)" "$CSS_FILE" "Help Center regressed to flat JPG banner background"
if [[ "$(grep -c 'background-size: 264px 264px;' "$CSS_FILE")" -lt 1 ]]; then
  fail "Desktop Help mascot size must be 264px"
fi
if [[ "$(grep -c 'background-size: 184px 184px;' "$CSS_FILE")" -lt 1 ]]; then
  fail "Mobile Help mascot size must be 184px"
fi

reject_grep '#9b22f4|#8b16f6|#bb22ff|#c026ff|#a31cff|#8518e7' "$CSS_FILE" "Violet regression tokens reappeared in globals.css"

require_grep 'docmee:tutorial-open' "$SIDEBAR_FILE" "Sidebar Tutorial replay trigger is missing"
require_grep 'Tutorial' "$SIDEBAR_FILE" "Sidebar Tutorial label is missing"
require_grep 'export function InAppTutorial' "$TUTORIAL_FILE" "InAppTutorial component is missing"
require_grep 'Conversation inbox' "$TUTORIAL_FILE" "Walkthrough conversation inbox step is missing"
require_grep 'Docmee, your assistant' "$TUTORIAL_FILE" "Walkthrough assistant step is missing"
require_grep 'Calendar and bookings' "$TUTORIAL_FILE" "Walkthrough calendar step is missing"
require_grep '<InAppTutorial />' "$ADMIN_LAYOUT_FILE" "Admin layout no longer mounts InAppTutorial"
require_grep '<InAppTutorial />' "$CLINIC_LAYOUT_FILE" "Clinic layout no longer mounts InAppTutorial"
reject_grep "asset: 'wordmark" "$ROOT/apps/inboxos/src/shared/components/PageMascotBanner.tsx" "Page banners must use mascot poses, not wordmark assets"

if command -v node >/dev/null 2>&1; then
  node - "$ROOT/apps/inboxos/public/brand/page-banners" <<'NODE'
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const dir = process.argv[2]

function fail(message) {
  console.error(`REGRESSION CHECK FAILED: ${message}`)
  process.exit(1)
}

function parsePng(file) {
  const bytes = fs.readFileSync(file)
  if (!bytes.slice(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    fail(`${path.basename(file)} is not a PNG`)
  }
  let offset = 8
  let width = 0
  let height = 0
  let colorType = -1
  const idat = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    const data = bytes.slice(dataStart, dataEnd)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset = dataEnd + 4
  }
  return { width, height, colorType, raw: zlib.inflateSync(Buffer.concat(idat)) }
}

function unfilterRgba(width, height, raw) {
  const bpp = 4
  const stride = width * bpp
  const out = Buffer.alloc(height * stride)
  let src = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[src++]
    const row = out.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? row[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      const value = raw[src++]
      let predictor = 0
      if (filter === 1) predictor = a
      else if (filter === 2) predictor = b
      else if (filter === 3) predictor = Math.floor((a + b) / 2)
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) {
        fail(`Unsupported PNG filter ${filter}`)
      }
      row[x] = (value + predictor) & 255
    }
  }
  return out
}

for (const name of fs.readdirSync(dir).filter((entry) => entry.endsWith('.png'))) {
  const file = path.join(dir, name)
  const { width, height, colorType, raw } = parsePng(file)
  if (width !== 900 || height !== 900) fail(`${name} is ${width}x${height}; expected 900x900`)
  if (colorType !== 6) fail(`${name} is not RGBA; transparent page banners must use alpha`)
  const pixels = unfilterRgba(width, height, raw)
  let transparent = 0
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 250) transparent++
  }
  if (transparent < width * height * 0.2) fail(`${name} does not contain enough transparent pixels`)
}
NODE
fi

if [[ "$source_only" == true ]]; then
  echo "Source regression checks passed."
  exit 0
fi

command -v curl >/dev/null 2>&1 || fail "curl is required for public checks"
curl -fsS "$APP_URL/login" >/dev/null || fail "Login page is not reachable at $APP_URL/login"
curl -fsS "$APP_URL/api/health" | grep -q '"ok":true' || fail "API health check failed at $APP_URL/api/health"

if command -v systemctl >/dev/null 2>&1; then
  systemctl is-active --quiet caddy || fail "caddy service is not active"
  systemctl is-active --quiet docmee.service || fail "docmee.service is not active"
fi

if command -v pm2 >/dev/null 2>&1; then
  pm2_output="$(pm2 list --no-color || true)"
  if echo "$pm2_output" | grep -q 'docmee-'; then
    echo "$pm2_output" | grep -q 'docmee-inboxos.*online' || fail "docmee-inboxos is not online in PM2"
    echo "$pm2_output" | grep -q 'docmee-api.*online' || fail "docmee-api is not online in PM2"
    echo "$pm2_output" | grep -q 'docmee-workers.*online' || fail "docmee-workers is not online in PM2"
  else
    pgrep -f 'pm2-runtime start ecosystem\.config\.cjs' >/dev/null || fail "pm2-runtime is not running docmee.service"
    pgrep -f 'apps/api/dist/apps/api/src/server\.js' >/dev/null || fail "docmee-api process is not running"
    pgrep -f 'apps/workers/dist/apps/workers/src/index\.js' >/dev/null || fail "docmee-workers process is not running"
    pgrep -f 'next-server' >/dev/null || fail "docmee-inboxos process is not running"
  fi
fi

echo "Live regression checks passed for $APP_URL."
