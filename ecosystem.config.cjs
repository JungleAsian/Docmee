// PM2 process definitions for the Docmee production VPS.
//
// Used by `pnpm tool deploy vps` (pm2 startOrReload ecosystem.config.cjs).
// Apps are resolved relative to this file's directory (VPS_DEPLOY_PATH), and
// must be built first — the deploy pipeline runs `pnpm ... build` before reload.
//
// Env: this file loads `.env.production` from its own directory (the deploy root,
// e.g. /var/www/docmee) and injects it into EVERY app process. PM2's `env:` does
// not read a file on its own, and the apps don't all load dotenv from the deploy
// root (api reads process.env directly; workers' dotenv reads apps/workers/), so
// without this the apps would boot on dev defaults despite the file existing.
// Locally (no .env.production) it's a no-op and apps keep their own defaults.
//
// Ports: api API_PORT=3001 (health at /health), inboxos PORT=3000. Override per
// app via .env.production as needed (NODE_ENV is always forced to production here).
// Production binds app servers to loopback; Caddy is the only public HTTP entry.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

function loadEnvFile(file) {
  const out = {}
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return out // no .env.production (e.g. local dev) — apps fall back to their own env
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    if (!key) continue
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const fileEnv = loadEnvFile(path.join(__dirname, '.env.production'))

function gitBuildId() {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: __dirname,
      encoding: 'utf8',
    }).trim()
    return commit ? `git-${commit}` : ''
  } catch {
    return ''
  }
}

function manifestBuildId() {
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'release-manifest.json'), 'utf8'),
    )
    return typeof manifest.buildId === 'string' ? manifest.buildId.trim() : ''
  } catch {
    return ''
  }
}

// The deploy shell supplies the exact commit before building. Keep a git-derived
// fallback for repository checkouts and a release-manifest fallback for certified
// archive deployments that intentionally contain no .git directory. Never let an
// old .env value override the release that was just checked out or unpacked.
const buildId =
  process.env.DOCMEE_BUILD_ID?.trim() ||
  gitBuildId() ||
  manifestBuildId() ||
  fileEnv.DOCMEE_BUILD_ID?.trim() ||
  'unversioned'
// File values are the base; release identity and NODE_ENV are authoritative.
const baseEnv = { ...fileEnv, DOCMEE_BUILD_ID: buildId, NODE_ENV: 'production' }

module.exports = {
  apps: [
    {
      name: 'docmee-api',
      cwd: './apps/api',
      // tsc has no rootDir (it pulls in packages/*), so it emits preserving the
      // monorepo path: apps/api/dist/apps/api/src/server.js — not dist/server.js.
      script: 'dist/apps/api/src/server.js',
      instances: 1,
      // fork (not cluster): Next.js `next start` can't run under Node's cluster
      // module, and there's no benefit to cluster at instances:1 for the others.
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: { ...baseEnv, API_HOST: fileEnv.API_HOST || '127.0.0.1' },
    },
    {
      name: 'docmee-workers',
      cwd: './apps/workers',
      script: 'dist/apps/workers/src/index.js',
      instances: 1,
      // fork (not cluster): Next.js `next start` can't run under Node's cluster
      // module, and there's no benefit to cluster at instances:1 for the others.
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: { ...baseEnv },
    },
    {
      name: 'docmee-inboxos',
      cwd: './apps/inboxos',
      // Run Next.js production server directly with node (most reliable under PM2).
      script: './node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1',
      instances: 1,
      // fork (not cluster): Next.js `next start` can't run under Node's cluster
      // module, and there's no benefit to cluster at instances:1 for the others.
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      env: { ...baseEnv, PORT: fileEnv.PORT || '3000' },
    },
  ],
}
