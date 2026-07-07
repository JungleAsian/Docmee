import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../lib/config.js'
import { log } from '../lib/logger.js'
import { deployDir, logsDir, toolsRoot } from '../lib/paths.js'
import { sendNotification, closeDiscordClient } from '../../../discord/src/bot.js'
import { switchMode, verifyMode, activeUrls, rollback as tunnelRollback, type TunnelDeps } from '../../../sentinel/tunnel/index.js'
import { loadConfig as loadSentinelConfig, updateLocalConfig } from '../../../sentinel/config/index.js'
import type { TunnelMode } from '../../../sentinel/config/schema.js'

const tunnelDeps: TunnelDeps = {
  getConfig: () => loadSentinelConfig().config,
  updateConfig: (patch) => updateLocalConfig(patch).config,
  onTargetsChanged: () => undefined, // running daemon picks up the config change via fs.watch
  audit: () => undefined
}

function requireVpsConfig() {
  loadConfig()
  const missing = ['VPS_HOST', 'VPS_USER', 'VPS_SSH_KEY_PATH', 'VPS_DEPLOY_PATH'].filter((name) => !process.env[name])
  if (missing.length > 0) {
    log('deploy', `Missing VPS settings: ${missing.join(', ')}`, 'warn')
    return false
  }
  return true
}

function ssh(args: string[]) {
  if (!requireVpsConfig()) return { ok: false, output: 'VPS settings missing' }
  const target = `${process.env.VPS_USER}@${process.env.VPS_HOST}`
  const result = spawnSync('ssh', ['-i', keyPath(), '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, ...args], {
    encoding: 'utf8',
    shell: true,
    stdio: 'pipe',
    windowsHide: true
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return { ok: result.status === 0, output }
}

function recordLock(action: string) {
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(path.join(logsDir, 'deploy-lock.json'), `${JSON.stringify({ action, createdAt: new Date().toISOString() }, null, 2)}\n`)
}

function keyPath() {
  return (process.env.VPS_SSH_KEY_PATH || '~/.ssh/id_ed25519').replace(/^~/, os.homedir())
}

// Copy a local file to the VPS over scp. localPath may contain spaces (the repo
// path does), so it's quoted for the shell.
function scpToVps(localPath: string, remotePath: string) {
  if (!requireVpsConfig()) return { ok: false, output: 'VPS settings missing' }
  const target = `${process.env.VPS_USER}@${process.env.VPS_HOST}:${remotePath}`
  const result = spawnSync(
    'scp',
    ['-i', `"${keyPath()}"`, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', `"${localPath}"`, target],
    { encoding: 'utf8', shell: true, stdio: 'pipe', windowsHide: true },
  )
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return { ok: result.status === 0, output }
}

// Deploy-critical env that must live in the VPS .env.production. 'critical' aborts
// the deploy; 'warn' is surfaced but allowed (the client has a same-host fallback).
const REQUIRED_PROD_ENV: Array<{ key: string; severity: 'critical' | 'warn'; note: string }> = [
  { key: 'DATABASE_URL', severity: 'critical', note: 'Postgres connection' },
  { key: 'REDIS_URL', severity: 'critical', note: 'Redis >= 5 (BullMQ)' },
  { key: 'CORS_ORIGINS', severity: 'critical', note: 'prod panel origin — the API blocks the panel if unset' },
  { key: 'NEXT_PUBLIC_API_URL', severity: 'warn', note: 'baked at build time; needed if the API is not at <host>:3001' }
]

function majorVersion(version: string): number | null {
  const match = /(\d+)\./.exec(version.trim())
  return match ? Number(match[1]) : null
}

// Validate the VPS is deploy-ready: .env.production exists with the required keys
// and NODE_ENV=production, Redis is >= 5, and the toolchain is installed. Returns
// ok=false when any blocking issue is found so `deploy vps` can abort early.
function vpsPreflight(): { ok: boolean } {
  const deployPath = process.env.VPS_DEPLOY_PATH as string
  const env = `${deployPath}/.env.production`
  const keys = REQUIRED_PROD_ENV.map((entry) => entry.key).join(' ')
  const remote = [
    `if [ -f ${env} ]; then echo ENVFILE_OK; for k in ${keys} NODE_ENV; do if grep -qE ^$k= ${env}; then echo ENV_OK $k=$(grep -E ^$k= ${env} | head -1 | cut -d= -f2-); else echo ENV_MISSING $k; fi; done; if grep -qE '^DATABASE_URL=' ${env}; then (grep -E '^DATABASE_URL=' ${env} | grep -qE 'sslmode=' && echo DBURL_SSL=yes || echo DBURL_SSL=no); (grep -E '^DATABASE_URL=' ${env} | grep -qE '@postgres[:/]' && echo DBURL_DOCKER=yes || echo DBURL_DOCKER=no); fi; else echo ENVFILE_MISSING; fi`,
    // Authenticate with the requirepass from REDIS_URL (redis-cli -u doesn't parse the
    // empty-username redis://:pass@ form, so extract the password and pass it via -a).
    `echo REDIS $(R=$(grep -E '^REDIS_URL=' ${env} 2>/dev/null | head -1 | cut -d= -f2-); P=$(echo $R | sed -nE 's#^redis://[^:]*:([^@]+)@.*#\\1#p'); redis-cli \${P:+-a $P --no-auth-warning} INFO server 2>/dev/null | grep -i redis_version | cut -d: -f2 || echo none)`,
    `for t in node pnpm pm2 caddy; do if command -v $t >/dev/null 2>&1; then echo TOOL_OK $t; else echo TOOL_MISSING $t; fi; done`
  ].join('; ')

  const res = ssh([`"${remote}"`])
  const out = (res.output || '').replace(/\r/g, '')
  if (!out) {
    log('deploy', 'Preflight could not reach the VPS — check SSH settings.', 'error')
    return { ok: false }
  }

  let critical = 0
  if (out.includes('ENVFILE_MISSING')) {
    log('deploy', `MISSING ${env} on the VPS — create it from .env.example before deploying.`, 'error')
    critical++
  } else {
    for (const entry of REQUIRED_PROD_ENV) {
      if (new RegExp(`ENV_MISSING ${entry.key}(\\s|$)`).test(out)) {
        log('deploy', `${entry.severity === 'critical' ? 'MISSING' : 'WARN'} env ${entry.key} — ${entry.note}`, entry.severity === 'critical' ? 'error' : 'warn')
        if (entry.severity === 'critical') critical++
      }
    }
    const nodeEnv = /ENV_OK NODE_ENV=(\S+)/.exec(out)?.[1]
    if (nodeEnv !== 'production') {
      log('deploy', `NODE_ENV is "${nodeEnv ?? 'unset'}" — must be production (a dev value breaks the inboxos build and loads the wrong env).`, 'error')
      critical++
    }
    // DATABASE_URL value sanity (checked redacted on the VPS — no secret echoed).
    if (/DBURL_DOCKER=yes/.test(out)) {
      log('deploy', 'DATABASE_URL host is "postgres" (a Docker service name) — it will not resolve on the VPS. Use the real DB host, e.g. the Supabase session pooler.', 'error')
      critical++
    } else if (/DBURL_SSL=no/.test(out)) {
      log('deploy', 'DATABASE_URL has no sslmode — Supabase/managed Postgres needs ?sslmode=require appended (the client does not enable SSL on its own).', 'warn')
    }
  }

  const redis = /REDIS (\S+)/.exec(out)?.[1]
  const redisMajor = redis && redis !== 'none' ? majorVersion(redis) : null
  if (!redis || redis === 'none') {
    log('deploy', 'Redis not reachable on the VPS (redis-cli).', 'error')
    critical++
  } else if (redisMajor !== null && redisMajor < 5) {
    log('deploy', `Redis ${redis} < 5.0 — BullMQ requires >= 5. Run "pnpm tool deploy redis".`, 'error')
    critical++
  } else {
    log('deploy', `Redis ${redis} OK (>= 5).`)
  }

  for (const tool of ['node', 'pnpm', 'pm2']) {
    if (new RegExp(`TOOL_MISSING ${tool}(\\s|$)`).test(out)) {
      log('deploy', `MISSING ${tool} on the VPS — run vps-bootstrap.sh.`, 'error')
      critical++
    }
  }
  if (/TOOL_MISSING caddy(\s|$)/.test(out)) {
    log('deploy', 'caddy not found (ok if you front the app with nginx instead).', 'warn')
  }

  if (critical === 0) log('deploy', 'Preflight passed — the VPS looks deploy-ready.')
  else log('deploy', `Preflight found ${critical} blocking issue(s) — fix before deploying.`, 'error')
  return { ok: critical === 0 }
}

export const deployCmd = new Command('deploy').description('Deploy locally or to Hostinger VPS')

deployCmd.command('redis').action(() => {
  log('deploy', 'Install Redis 7 from the official Redis repository; do not use the Ubuntu apt default Redis 6 package.')
  console.log('sudo install -m 0755 -d /etc/apt/keyrings')
  console.log('curl -fsSL https://packages.redis.io/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/redis-archive-keyring.gpg')
  console.log('echo "deb [signed-by=/etc/apt/keyrings/redis-archive-keyring.gpg] https://packages.redis.io/deb $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/redis.list')
  console.log('sudo apt-get update && sudo apt-get install redis -y')
})

deployCmd.command('check').action(() => {
  const result = ssh(['"node -v; pnpm -v; pm2 -v; caddy version; redis-cli ping; redis-cli INFO server | grep redis_version; ufw status"'])
  log('deploy', result.ok ? 'VPS check completed' : `VPS check failed: ${result.output}`, result.ok ? 'info' : 'warn')
})

deployCmd
  .command('preflight')
  .description('Validate the VPS is deploy-ready (.env.production keys, NODE_ENV=production, Redis >=5, toolchain)')
  .action(() => {
    if (!requireVpsConfig()) {
      process.exitCode = 1
      return
    }
    if (!vpsPreflight().ok) process.exitCode = 1
  })

deployCmd.command('keygen').action(() => {
  loadConfig()
  const privateKey = keyPath()
  const publicKey = `${privateKey}.pub`
  if (!fs.existsSync(privateKey)) {
    fs.mkdirSync(path.dirname(privateKey), { recursive: true })
    const result = spawnSync('ssh-keygen', ['-t', 'ed25519', '-f', privateKey, '-N', '', '-C', 'docmee-devtools'], { encoding: 'utf8', stdio: 'pipe', windowsHide: true })
    if (result.status !== 0) {
      log('deploy', `SSH key generation failed: ${result.stderr || result.stdout}`, 'error')
      process.exitCode = 1
      return
    }
  }
  log('deploy', `SSH private key: ${privateKey}`)
  if (fs.existsSync(publicKey)) console.log(fs.readFileSync(publicKey, 'utf8').trim())
})

deployCmd.command('setup').action(() => {
  const script = path.join(deployDir, 'setup', 'vps-setup.sh')
  log('deploy', `Run one-time VPS setup with ${script}. Review it before copying to production.`)
})

deployCmd
  .command('env')
  .description('Sync the local .env.production up to the VPS (scp). Overwrites the VPS file.')
  .action(() => {
    if (!requireVpsConfig()) {
      process.exitCode = 1
      return
    }
    const repoRoot = path.resolve(toolsRoot, '..')
    const envName = process.env.ENV_PRODUCTION_PATH || '.env.production'
    const localEnv = path.isAbsolute(envName) ? envName : path.join(repoRoot, envName)
    if (!fs.existsSync(localEnv)) {
      log('deploy', `Local ${localEnv} not found — create it first (cp .env.example .env.production at the repo root).`, 'error')
      process.exitCode = 1
      return
    }
    const deployPath = process.env.VPS_DEPLOY_PATH as string
    const remote = `${deployPath}/.env.production`
    log('deploy', 'NOTE: this overwrites the VPS file — make sure the local values are VPS-appropriate (real domain in APP_URL/CORS_ORIGINS, the VPS Postgres host in DATABASE_URL, not @postgres/localhost).', 'warn')
    log('deploy', `Syncing ${localEnv} → ${process.env.VPS_HOST}:${remote} ...`)
    const res = scpToVps(localEnv, remote)
    if (!res.ok) {
      log('deploy', `.env sync failed: ${res.output || 'scp error'}`, 'error')
      process.exitCode = 1
      return
    }
    // Confirm the deploy-critical keys actually landed.
    const verify = ssh([`"for k in DATABASE_URL NODE_ENV REDIS_URL CORS_ORIGINS; do grep -qE ^$k= ${remote} && echo OK:$k || echo MISSING:$k; done"`])
    log('deploy', `.env.production synced to the VPS. ${verify.output.replace(/\s+/g, ' ')}`)
  })

deployCmd.command('vps').option('--skip-preflight', 'Skip the env/Redis preflight (not recommended)').action(async (opts: { skipPreflight?: boolean }) => {
  if (!requireVpsConfig()) {
    process.exitCode = 1
    return
  }
  if (!opts.skipPreflight) {
    log('deploy', 'Running pre-deploy checks (env, Redis, toolchain)...')
    if (!vpsPreflight().ok) {
      log('deploy', 'Aborting deploy — fix the issues above, or re-run with --skip-preflight.', 'error')
      await sendNotification('VPS deploy aborted at preflight (env/Redis not ready).', 'critical')
      await closeDiscordClient()
      process.exitCode = 1
      return
    }
  }
  recordLock('vps')
  const branch = process.env.GITHUB_BRANCH || 'main'
  const deployPath = process.env.VPS_DEPLOY_PATH as string
  const ecosystem = process.env.PM2_ECOSYSTEM_FILE || 'ecosystem.config.cjs'
  // Build product apps in dependency order (db first). Overridable for unusual setups.
  // Build EVERY workspace package the apps import at runtime (not just db) plus the
  // three apps — otherwise @docmee/queue, @docmee/agents, etc. have no dist and the
  // apps fail at runtime with "Cannot find package". Topological order is handled by pnpm.
  const buildCmd = process.env.VPS_BUILD_CMD
    || 'pnpm install --frozen-lockfile && pnpm --filter @docmee/shared --filter @docmee/config --filter @docmee/db --filter @docmee/queue --filter @docmee/llm --filter @docmee/channels --filter @docmee/notifications --filter @docmee/kb --filter @docmee/agents --filter @docmee/api --filter @docmee/workers --filter @docmee/inboxos build'
  const migrateCmd = process.env.VPS_MIGRATE_CMD || 'pnpm --filter @docmee/db db:migrate'

  // 1) Push the current HEAD to the deploy branch the VPS pulls from.
  log('deploy', `Pushing HEAD to origin/${branch}...`)
  const push = spawnSync('git', ['push', 'origin', `HEAD:${branch}`], {
    cwd: path.resolve(toolsRoot, '..'),
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  })
  if (push.status !== 0) {
    log('deploy', `git push failed: ${(push.stderr || push.stdout || '').trim()}`, 'error')
    await sendNotification('VPS deploy aborted: git push failed.', 'critical')
    await closeDiscordClient()
    process.exitCode = 1
    return
  }

  // Repo URL the VPS clones from on first deploy (the VPS needs its own GitHub
  // auth — a deploy key/token — for a private repo).
  const repoUrl = process.env.DEPLOY_REPO_URL
    || (spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: path.resolve(toolsRoot, '..'), encoding: 'utf8', windowsHide: true }).stdout || '').trim()

  // 2) On the VPS: bootstrap the clone if missing, then sync to the pushed
  // commit, install, build, migrate, and reload PM2.
  const remote = [
    `mkdir -p $(dirname ${deployPath})`,
    `if [ ! -d ${deployPath}/.git ]; then git clone ${repoUrl} ${deployPath}; fi`,
    `cd ${deployPath}`,
    'git fetch --all --prune',
    `git reset --hard origin/${branch}`,
    // Export .env.production into this shell BEFORE building, so build-time vars
    // (e.g. inboxos NEXT_PUBLIC_API_URL, baked into the client bundle) take effect.
    // pm2 --update-env then inherits the same env, and ecosystem.config.cjs also
    // loads the file directly — belt and suspenders. No-op if the file is absent.
    'set -a; . ./.env.production 2>/dev/null || true; set +a',
    buildCmd,
    migrateCmd,
    `pm2 startOrReload ${ecosystem} --update-env`,
    'pm2 save'
  ].join(' && ')
  log('deploy', 'Running remote deploy (sync, install, build, migrate, PM2 reload)...')
  const remoteResult = ssh([`"${remote}"`])
  if (remoteResult.output) log('deploy', remoteResult.output)
  if (!remoteResult.ok) {
    log('deploy', 'Remote deploy step failed. The VPS may be in a partial state — review the output above.', 'error')
    await sendNotification('VPS deploy failed during the remote build/reload step.', 'critical')
    await closeDiscordClient()
    process.exitCode = 1
    return
  }

  // 3) Health check the API via the reverse proxy ON the VPS (localhost). The app
  // port (3001) is never public, and public :80 may be firewalled too (ngrok-only
  // setups where the origin isn't exposed) — so curl Caddy on the box itself, the
  // same path a request takes once it reaches the server.
  // Retry: the API needs a few seconds to start listening after a PM2 reload, so an
  // immediate check can catch Caddy proxying to a not-yet-ready upstream (502).
  const healthRes = ssh([
    `"for i in $(seq 1 8); do c=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:80/api/health); case $c in 200) break;; esac; sleep 3; done; echo $c"`,
  ])
  const code = /\d{3}/.exec(healthRes.output || '')?.[0]
  const healthy = healthRes.ok && code === '200'
  if (healthy) log('deploy', `Health /api/health (via Caddy on the VPS): HTTP ${code}`)
  else log('deploy', `Health check failed: ${healthRes.output || 'no response'}`, 'warn')
  if (!healthy) process.exitCode = 1
  await sendNotification(
    healthy
      ? `VPS deploy succeeded (branch ${branch}). API health OK.`
      : `VPS deploy ran but the API health check did not pass — verify the VPS.`,
    healthy ? 'development' : 'critical'
  )
  await closeDiscordClient()
})

deployCmd
  .command('local')
  .option('--no-browser', 'Do not open a browser (used by the Playwright webServer)')
  .action(() => {
    const compose = path.resolve(toolsRoot, '..', 'docker-compose.yml')
    if (fs.existsSync(compose)) spawnSync('docker', ['compose', 'up', '-d'], { cwd: path.dirname(compose), stdio: 'inherit', shell: true, windowsHide: true })
    log('deploy', 'Local deploy requested. Product app processes start after Docmee app phases create /apps.')
  })

deployCmd.command('health').option('--target <target>', 'local or vps', 'local').action(async (opts: { target: string }) => {
  loadConfig()
  const host = opts.target === 'vps' ? process.env.VPS_DOMAIN || process.env.VPS_HOST || 'localhost' : 'localhost'
  const url = `http://${host}:3001/health`
  try {
    const response = await fetch(url)
    log('deploy', `Health ${url}: HTTP ${response.status}`, response.ok ? 'info' : 'warn')
    if (!response.ok) process.exitCode = 1
  } catch (error) {
    log('deploy', `Health ${url} failed: ${String(error)}`, 'warn')
    process.exitCode = 1
  }
})

deployCmd.command('status').action(() => {
  const result = ssh(['"pm2 status; redis-cli ping; df -h; free -h"'])
  log('deploy', result.ok ? 'VPS status completed' : `VPS status failed: ${result.output}`, result.ok ? 'info' : 'warn')
})

deployCmd.command('logs').option('--service <service>', 'Service name', 'all').action((opts: { service: string }) => {
  const service = opts.service === 'all' ? '' : opts.service
  const result = ssh([`"pm2 logs ${service} --lines 100 --nostream"`])
  log('deploy', result.ok ? 'VPS logs fetched' : `VPS logs failed: ${result.output}`, result.ok ? 'info' : 'warn')
})

deployCmd.command('restart').requiredOption('--service <service>').action((opts: { service: string }) => {
  const result = ssh([`"pm2 reload ${opts.service}"`])
  log('deploy', result.ok ? `Restarted ${opts.service}` : `Restart failed: ${result.output}`, result.ok ? 'info' : 'warn')
})

deployCmd.command('rollback').action(async () => {
  recordLock('rollback')
  log('deploy', 'Rollback plan: SSH checkout previous commit, rebuild, PM2 reload, health check.')
  await sendNotification('Rollback requested. Confirm target commit before production rollback.', 'critical')
  await closeDiscordClient()
})

deployCmd.command('migrate').action(() => {
  const result = ssh(['"pnpm tool migrate run"'])
  log('deploy', result.ok ? 'Remote migrations completed' : `Remote migration failed: ${result.output}`, result.ok ? 'info' : 'warn')
})

// --- Tunnel Switcher (Sentinel owns the config; DevTools mirrors it) ---
const tunnelCmd = new Command('tunnel').description('Tunnel Switcher — None / ngrok / Cloudflare / Permanent')

tunnelCmd.command('status').description('Show active mode and all URLs').action(() => {
  const config = loadSentinelConfig().config
  const urls = activeUrls(config)
  log('deploy', `Tunnel mode: ${config.tunnel.activeMode} (verified ${config.tunnel.lastVerified ?? 'never'})`)
  log('deploy', `App:      ${urls.appUrl || '—'}`)
  log('deploy', `API:      ${urls.apiUrl || '—'}`)
  log('deploy', `DevTools: ${urls.devtoolsUrl || '—'}`)
  log('deploy', `Webhook:  ${urls.webhookUrl || '—'}`)
})

tunnelCmd.command('verify').description('Run a health check on the active mode without switching').action(async () => {
  const config = loadSentinelConfig().config
  const result = await verifyMode(config, config.tunnel.activeMode)
  for (const c of result.checks) log('deploy', `${c.ok ? 'OK ' : 'FAIL'} ${c.label}: ${c.detail}`, c.ok ? 'info' : 'warn')
  log('deploy', result.ok ? 'Tunnel verify passed.' : 'Tunnel verify failed.', result.ok ? 'info' : 'warn')
})

tunnelCmd
  .command('switch')
  .argument('<mode>', 'none | ngrok | cloudflare | permanent')
  .description('Switch tunnel mode (verifies first for all modes except none)')
  .action(async (mode: string) => {
    const modes: TunnelMode[] = ['none', 'ngrok', 'cloudflare', 'permanent']
    if (!modes.includes(mode as TunnelMode)) return log('deploy', `Invalid mode: ${mode}`, 'warn')
    const result = await switchMode(tunnelDeps, mode as TunnelMode)
    if (!result.ok) {
      for (const c of result.verify.checks) if (!c.ok) log('deploy', `FAIL ${c.label}: ${c.detail}`, 'warn')
      return log('deploy', `Switch blocked: ${result.blocked}`, 'warn')
    }
    log('deploy', `Switched to ${result.mode}. .env.tools updated.`)
    if (result.webhookChanged) log('deploy', `⚠️ WhatsApp webhook changed → ${result.urls.webhookUrl}. Update it in the Meta dashboard.`, 'warn')
  })

tunnelCmd.command('webhook').description('Print the current WhatsApp webhook URL').action(() => {
  log('deploy', activeUrls(loadSentinelConfig().config).webhookUrl || '— (no external mode active)')
})

tunnelCmd.command('rollback').description('Roll back to the previous tunnel mode').action(async () => {
  const result = await tunnelRollback(tunnelDeps)
  log('deploy', result.ok ? `Rolled back to ${result.mode}.` : `Rollback blocked: ${result.blocked}`, result.ok ? 'info' : 'warn')
})

deployCmd.addCommand(tunnelCmd)
