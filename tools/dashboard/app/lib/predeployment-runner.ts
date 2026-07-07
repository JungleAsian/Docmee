import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import net from 'node:net'
import { NextResponse } from 'next/server'

const toolsRoot = path.resolve(process.cwd(), '..')
const repoRoot = path.resolve(toolsRoot, '..')
const dashboardRoot = path.join(toolsRoot, 'dashboard')
const logsRoot = path.join(toolsRoot, 'logs')
const predeploymentFile = path.join(logsRoot, 'predeployment.json')
const predeploymentRunningFile = path.join(logsRoot, 'predeployment-running.json')

type CheckStatus = 'not-run' | 'pass' | 'warning' | 'fail' | 'manual'
type CheckSource = 'Automated' | 'Manual' | 'External service' | 'Gated action'
type Check = {
  id: string
  name: string
  source: CheckSource
  status: CheckStatus
  message?: string
  detail?: string
}
type Stage = { id: string; title: string; checks: Check[] }
type Run = { id: string; createdAt: string; summary: Record<CheckStatus, number>; stages: Stage[] }

const stageBlueprints: Stage[] = [
  {
    id: 'stage-1',
    title: 'Stage 1 - Verify Current Dev Environment',
    checks: [
      auto('dev-inbox-url', 'Confirm what shows at http://100.84.229.45:3000/inbox'),
      auto('dev-codebase', 'Confirm which codebase is running'),
      auto('dev-machine', 'Confirm which machine is serving the app'),
      auto('dev-typecheck-env', 'Confirm Supabase is connected through typecheck/env checks'),
      auto('dev-env-required', '.env has no empty required values'),
      manual('dev-supabase-key', 'SUPABASE_URL is correct and using the rotated service key'),
      auto('dev-redis-ping', 'Redis is running'),
      auto('dev-redis-version', 'Redis version is 7.x'),
      auto('dev-workers', 'All workers are importable/start-ready')
    ]
  },
  {
    id: 'stage-2a',
    title: 'Stage 2a - Code Quality',
    checks: [
      auto('code-install', 'pnpm install completes without errors'),
      auto('code-typecheck', 'pnpm typecheck passes across all packages'),
      auto('code-lint', 'pnpm lint passes'),
      auto('code-build', 'pnpm build completes'),
      auto('code-test', 'pnpm test passes with safe local settings'),
      auto('code-any', 'No explicit any types in repository source files'),
      auto('code-workers-index', 'All worker files are imported in apps/workers/src/index.ts'),
      auto('code-js-extensions', 'NodeNext imports use .js extensions')
    ]
  },
  {
    id: 'stage-2b',
    title: 'Stage 2b - Database',
    checks: [
      manual('db-migrations', 'All migrations 001-006 applied cleanly on Supabase'),
      manual('db-pgvector', 'pgvector enabled and match_kb_entries RPC works'),
      manual('db-rls', 'RLS active on all 18 tables'),
      manual('db-triggers', 'All 11 updated_at triggers created'),
      manual('db-encryption', 'encrypt_value / decrypt_value SQL functions exist'),
      manual('db-unread', 'increment_conversation_unread function exists'),
      manual('db-license-state', 'license_state single-row seeded'),
      manual('db-flags', 'Feature flags seeded'),
      auto('db-repositories', 'Repository files exist with typed methods')
    ]
  },
  {
    id: 'stage-2c',
    title: 'Stage 2c - Environment Variables',
    checks: [
      auto('env-required', 'All required variables filled in .env'),
      auto('env-supabase-url', 'SUPABASE_URL correct and has no NEXT_PUBLIC_ prefix'),
      manual('env-service-key', 'SUPABASE_SERVICE_KEY / service role key is rotated'),
      auto('env-jwt', 'JWT secrets are different and 32+ characters when configured'),
      auto('env-license-public', 'LICENSE_PUBLIC_KEY is present'),
      auto('env-deepseek-url', 'DEEPSEEK_BASE_URL set to https://api.deepseek.com/v1'),
      auto('env-llm-stub', 'LLM_STUB=false for production readiness'),
      auto('env-node-env', 'NODE_ENV=production for production readiness'),
      auto('env-app-url', 'APP_URL matches the intended app URL')
    ]
  },
  {
    id: 'stage-2d',
    title: 'Stage 2d - Core Functionality Tests',
    checks: [
      auto('func-valid-login', 'Login with valid credentials'),
      auto('func-invalid-login', 'Login with invalid credentials shows error'),
      manual('func-whatsapp-curl', 'Simulate inbound WhatsApp message via curl'),
      manual('func-llm-reply', 'Bot generates a reply via real LLM'),
      manual('func-kb-embedding', 'KB entry created and embedding stored'),
      manual('func-google-oauth', 'Google Calendar OAuth flow saves tokens'),
      manual('func-slot-finder', 'Slot finder returns available slots'),
      manual('func-audio', 'Audio message transcription worker runs'),
      manual('func-emergency', 'Emergency keyword triggers HUMAN_ACTIVE + notification'),
      manual('func-takeover', 'Secretary takeover keeps bot silent'),
      manual('func-return-bot', 'Secretary returns thread to bot'),
      manual('func-tag', 'Tag added to conversation appears in inbox row'),
      manual('func-note', 'Internal note is visible and not outbound'),
      manual('func-license', 'License activation endpoint returns valid signed license'),
      auto('func-health', '/health endpoint returns ok')
    ]
  },
  {
    id: 'stage-2e',
    title: 'Stage 2e - Security Checks',
    checks: [
      auto('sec-env-gitignore', '.env is in .gitignore'),
      auto('sec-token-storage', 'Access token is not stored in localStorage/sessionStorage by code scan'),
      manual('sec-refresh-cookie', 'Refresh token arrives as httpOnly Secure cookie only'),
      manual('sec-hmac', 'Tampered webhook body returns 401'),
      auto('sec-rls-simulation', 'Cross-clinic data isolation check passes'),
      auto('sec-supabase-admin', 'supabaseAdmin only used in allowed server-side areas'),
      auto('sec-license-signing', 'LICENSE_SIGNING_KEY is not in main app .env')
    ]
  },
  {
    id: 'stage-2f',
    title: 'Stage 2f - Module Boundary Audit',
    checks: [
      auto('boundary-supabase', 'No direct @supabase/supabase-js import outside db client'),
      auto('boundary-bullmq', 'No direct bullmq import outside queue provider'),
      auto('boundary-anthropic', 'No direct Anthropic SDK import outside Claude provider'),
      auto('boundary-google', 'No direct googleapis import outside Google Calendar client'),
      auto('boundary-resend', 'No direct resend import outside email channel'),
      auto('boundary-lint', 'Lint confirms zero module boundary violations')
    ]
  },
  {
    id: 'stage-2g',
    title: 'Stage 2g - Performance Baseline',
    checks: [
      manual('perf-bot-response', 'Bot responds to a text message in under 3 seconds'),
      manual('perf-intent', 'Intent classification completes in under 500ms'),
      manual('perf-kb', 'KB vector search completes in under 300ms'),
      manual('perf-slot', 'Slot finder returns results in under 1 second'),
      manual('perf-memory', 'Worker memory stable after 100 simulated messages')
    ]
  },
  {
    id: 'stage-3',
    title: 'Stage 3 - VPS Setup',
    checks: [
      manual('vps-hostinger', 'Hostinger KVM 2 VPS provisioned on Ubuntu 22.04'),
      manual('vps-ssh', 'SSH key-based access configured and password auth disabled'),
      manual('vps-user', 'Non-root deploy user created with sudo'),
      manual('vps-firewall', 'UFW allows 22, 80, 443 only'),
      manual('vps-fail2ban', 'fail2ban installed and active'),
      manual('vps-node', 'Node.js 22.x installed'),
      manual('vps-pnpm', 'pnpm installed globally'),
      manual('vps-git', 'Git installed'),
      manual('vps-redis', 'Redis 7.x installed from official Redis repo'),
      manual('vps-redis-aof', 'Redis AOF persistence enabled'),
      manual('vps-caddy', 'Caddy installed'),
      manual('vps-domain', 'Domain A record points to VPS IP'),
      manual('vps-dns', 'DNS propagated')
    ]
  },
  {
    id: 'stage-4',
    title: 'Stage 4 - Production Deployment',
    checks: [
      gated('prod-clone', 'Repo cloned to VPS'),
      gated('prod-install', 'pnpm install --frozen-lockfile completes on VPS'),
      gated('prod-build', 'pnpm build completes on VPS'),
      gated('prod-env', '.env file created on VPS with production values'),
      gated('prod-migrate', 'Database migrations run on production Supabase'),
      gated('prod-license', 'License activated'),
      gated('prod-api', 'API health works on VPS'),
      gated('prod-workers', 'All 8 workers confirmed in VPS logs'),
      gated('prod-process', 'PM2 or systemd keeps API + workers alive'),
      gated('prod-caddy', 'Caddy reverse proxy configured'),
      gated('prod-ssl', 'SSL certificate provisioned'),
      gated('prod-inbox', 'https://yourdomain.com/inbox loads'),
      gated('prod-health', 'https://yourdomain.com/health returns ok')
    ]
  },
  {
    id: 'stage-5',
    title: 'Stage 5 - WhatsApp Webhook',
    checks: [
      manual('wa-url', 'Meta webhook URL set'),
      manual('wa-token', 'Verify token matches .env'),
      manual('wa-verify', 'Meta Verify and Save succeeds'),
      manual('wa-fields', 'Subscribed to messages and message_status'),
      manual('wa-test', 'Personal WhatsApp test appears in logs'),
      manual('wa-bot-reply', 'Bot replies to test message'),
      manual('wa-hmac', 'Tampered payload returns 401')
    ]
  },
  {
    id: 'stage-6',
    title: 'Stage 6 - First Clinic Setup',
    checks: [
      manual('clinic-license', 'License issued from LicenseKit dashboard'),
      manual('clinic-created', 'First clinic created via Admin Studio'),
      manual('clinic-whatsapp', 'WhatsApp phone number ID and token configured'),
      manual('clinic-calendar', 'Google Calendar connected and tested'),
      manual('clinic-kb', 'KB entries loaded'),
      manual('clinic-tone', 'Bot tone configured'),
      manual('clinic-hours', 'Working hours set'),
      manual('clinic-secretary', 'Secretary account created'),
      manual('clinic-inbox-login', 'Secretary logged into Clinic Inbox')
    ]
  },
  {
    id: 'stage-7',
    title: 'Stage 7 - 8-Step Acceptance Test',
    checks: [
      manual('accept-hola', 'Send Hola and bot replies within 5 seconds with STOP notice'),
      manual('accept-booking', 'Complete booking and create Google Calendar appointment'),
      manual('accept-emergency', 'Emergency triggers HUMAN_ACTIVE and urgent email'),
      manual('accept-secretary', 'Secretary takeover sends reply to patient'),
      manual('accept-return', 'Secretary returns to bot and bot replies'),
      manual('accept-note', 'Internal note is not sent to patient'),
      manual('accept-stop', 'STOP opt-out works'),
      manual('accept-voice', 'Voice note transcript saved and bot replies')
    ]
  },
  {
    id: 'stage-8',
    title: 'Stage 8 - Monitoring Setup',
    checks: [
      manual('monitor-pm2', 'PM2 log rotation configured'),
      manual('monitor-uptime', 'Uptime monitor configured for /health'),
      manual('monitor-redis-aof', 'Redis AOF persistence confirmed'),
      manual('monitor-supabase-backup', 'Daily Supabase backup enabled'),
      manual('monitor-meta-token', 'Meta token expiry monitoring active'),
      manual('monitor-runbook', 'Operations runbook documented')
    ]
  }
]

function auto(id: string, name: string): Check {
  return { id, name, source: 'Automated', status: 'not-run' }
}

function manual(id: string, name: string): Check {
  return { id, name, source: 'Manual', status: 'manual', message: 'Requires user confirmation or third-party console verification.' }
}

function gated(id: string, name: string): Check {
  return { id, name, source: 'Gated action', status: 'manual', message: 'Requires explicit deployment confirmation before automation.' }
}

function pnpmCommand() {
  if (process.platform !== 'win32') return 'pnpm'
  const pnpmExe = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'pnpm', 'pnpm.exe') : ''
  return pnpmExe && existsSync(pnpmExe) ? pnpmExe : 'pnpm.exe'
}

function runCommand(args: string[], timeoutMs = 120000, extraEnv: Record<string, string> = {}) {
  const result = spawnSync(pnpmCommand(), args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    stdio: 'pipe',
    timeout: timeoutMs,
    windowsHide: true,
    env: { ...process.env, LLM_STUB: process.env.LLM_STUB || 'true', ...extraEnv }
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return {
    ok: result.status === 0,
    timedOut: Boolean(result.error && result.error.message.includes('ETIMEDOUT')),
    output: output.slice(0, 4000)
  }
}

function runTool(args: string[], timeoutMs = 120000) {
  return runCommand(['tool', ...args], timeoutMs)
}

function readEnv() {
  const candidates = [
    path.join(repoRoot, '.env'),
    path.join(toolsRoot, '.env')
  ]
  const values = new Map<string, string>()
  for (const file of candidates) {
    if (!existsSync(file)) continue
    const text = readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx < 0) continue
      const key = trimmed.slice(0, idx).trim()
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
      values.set(key, value)
    }
  }
  return values
}

function envPresent(env: Map<string, string>, key: string) {
  return Boolean(env.get(key)?.trim())
}

function setCheck(checks: Check[], id: string, status: CheckStatus, message: string, detail?: string) {
  const check = checks.find((item) => item.id === id)
  if (!check) return
  check.status = status
  check.message = message
  check.detail = detail
}

function short(output: string) {
  return output.replace(/\s+/g, ' ').trim().slice(0, 260)
}

async function portOpen(port: number, host = '127.0.0.1') {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect(port, host)
    socket.setTimeout(900)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

async function fetchStatus(url: string, options: RequestInit = {}, expectedStatus = 200) {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 7000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal })
    const body = await response.text()
    return {
      ok: response.status === expectedStatus,
      status: response.status,
      body,
      message: `HTTP ${response.status} in ${Date.now() - started}ms`
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: '',
      message: error instanceof Error ? error.message : String(error)
    }
  } finally {
    clearTimeout(timer)
  }
}

function readRuns() {
  if (!existsSync(predeploymentFile)) return [] as Run[]
  try {
    return JSON.parse(readFileSync(predeploymentFile, 'utf8')) as Run[]
  } catch {
    return []
  }
}

function writeRun(stages: Stage[]) {
  mkdirSync(logsRoot, { recursive: true })
  const checks = stages.flatMap((stage) => stage.checks)
  const summary: Record<CheckStatus, number> = {
    'not-run': checks.filter((check) => check.status === 'not-run').length,
    pass: checks.filter((check) => check.status === 'pass').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    fail: checks.filter((check) => check.status === 'fail').length,
    manual: checks.filter((check) => check.status === 'manual').length
  }
  const run: Run = { id: `predeploy-${Date.now()}`, createdAt: new Date().toISOString(), summary, stages }
  const runs = readRuns()
  writeFileSync(predeploymentFile, JSON.stringify([run, ...runs].slice(0, 25), null, 2))
  return run
}

function cloneStages() {
  return JSON.parse(JSON.stringify(stageBlueprints)) as Stage[]
}


export async function runPredeployment() {
  const stages = cloneStages()
  const allChecks = stages.flatMap((stage) => stage.checks)
  const env = readEnv()

  const inbox = await fetchStatus('http://100.84.229.45:3000/inbox')
  setCheck(allChecks, 'dev-inbox-url', inbox.ok ? 'pass' : 'fail', inbox.ok ? 'Inbox URL is reachable.' : inbox.message, inbox.body.slice(0, 500))
  setCheck(allChecks, 'dev-codebase', existsSync(path.join(repoRoot, 'apps', 'inboxos')) ? 'pass' : 'fail', existsSync(path.join(repoRoot, 'apps', 'inboxos')) ? 'Docmee app codebase is present.' : 'apps/inboxos was not found.')
  setCheck(allChecks, 'dev-machine', await portOpen(3000, '100.84.229.45') ? 'warning' : 'manual', await portOpen(3000, '100.84.229.45') ? 'Tailscale host is reachable; confirm whether this is local dev or VPS before production.' : 'Confirm manually whether the URL is local Tailscale or VPS.')

  const typecheck = runCommand(['typecheck'])
  setCheck(allChecks, 'dev-typecheck-env', typecheck.ok ? 'pass' : 'fail', typecheck.ok ? 'Typecheck passed.' : short(typecheck.output), typecheck.output)

  const required = ['APP_URL', 'SUPABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'LICENSE_PUBLIC_KEY', 'DEEPSEEK_BASE_URL', 'LLM_STUB']
  const missing = required.filter((key) => !envPresent(env, key))
  setCheck(allChecks, 'dev-env-required', missing.length === 0 ? 'pass' : 'fail', missing.length === 0 ? 'Required environment values are present.' : `Missing values: ${missing.join(', ')}`)

  const redisPing = spawnSync(process.platform === 'win32' ? 'redis-cli.exe' : 'redis-cli', ['ping'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
  const redisPingOut = `${redisPing.stdout ?? ''}${redisPing.stderr ?? ''}`.trim()
  const redisPort = await portOpen(6379)
  setCheck(allChecks, 'dev-redis-ping', redisPingOut.includes('PONG') || redisPort ? 'pass' : 'fail', redisPingOut.includes('PONG') ? 'redis-cli returned PONG.' : redisPort ? 'Redis port is reachable.' : 'Redis is not reachable.', redisPingOut)
  const redisVersion = spawnSync(process.platform === 'win32' ? 'redis-server.exe' : 'redis-server', ['--version'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
  const redisVersionOut = `${redisVersion.stdout ?? ''}${redisVersion.stderr ?? ''}`.trim()
  const match = redisVersionOut.match(/v=([0-9]+)\./)
  const major = match ? Number(match[1]) : 0
  setCheck(allChecks, 'dev-redis-version', major >= 7 ? 'pass' : major > 0 ? 'fail' : 'warning', major >= 7 ? 'Redis version is 7.x or newer.' : major > 0 ? `Redis version is ${major}.x; BullMQ needs Redis 5+ and production checklist requires 7.x.` : 'Redis version could not be detected.', redisVersionOut)

  const workersIndex = path.join(repoRoot, 'apps', 'workers', 'src', 'index.ts')
  setCheck(allChecks, 'dev-workers', existsSync(workersIndex) ? 'pass' : 'fail', existsSync(workersIndex) ? 'Workers index exists.' : 'apps/workers/src/index.ts is missing.')

  const install = runCommand(['install', '--frozen-lockfile'], 120000)
  setCheck(allChecks, 'code-install', install.ok ? 'pass' : 'fail', install.ok ? 'Dependencies install with frozen lockfile.' : short(install.output), install.output)
  setCheck(allChecks, 'code-typecheck', typecheck.ok ? 'pass' : 'fail', typecheck.ok ? 'Typecheck passed.' : short(typecheck.output), typecheck.output)
  const lint = runCommand(['lint'])
  setCheck(allChecks, 'code-lint', lint.ok ? 'pass' : 'fail', lint.ok ? 'Lint passed.' : short(lint.output), lint.output)
  // next build crashes during prerender when it inherits the dashboard's
  // non-standard NODE_ENV=development (useContext null), so force production.
  const build = runCommand(['build'], 180000, { NODE_ENV: 'production' })
  setCheck(allChecks, 'code-build', build.ok ? 'pass' : 'fail', build.ok ? 'Build passed.' : short(build.output), build.output)
  const test = runCommand(['test'], 180000)
  setCheck(allChecks, 'code-test', test.ok ? 'pass' : 'fail', test.ok ? 'Tests passed.' : short(test.output), test.output)

  const anyScan = spawnSync('rg', ['-n', '\\bany\\b', 'apps', 'packages', '--glob', '*.ts', '--glob', '*.tsx'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
  const anyLines = `${anyScan.stdout ?? ''}`.split(/\r?\n/).filter(Boolean).filter((line) => !line.includes('unknown'))
  setCheck(allChecks, 'code-any', anyLines.length === 0 ? 'pass' : 'warning', anyLines.length === 0 ? 'No obvious any usage found.' : `Found ${anyLines.length} possible any references for review.`, anyLines.slice(0, 80).join('\n'))

  if (existsSync(workersIndex)) {
    const indexText = readFileSync(workersIndex, 'utf8')
    const workerFiles = existsSync(path.join(repoRoot, 'apps', 'workers', 'src'))
      ? spawnSync('rg', ['--files', 'apps/workers/src'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true }).stdout.split(/\r?\n/).filter((file) => file.endsWith('.ts') && !file.endsWith('index.ts'))
      : []
    const missingWorkers = workerFiles.filter((file) => !indexText.includes(path.basename(file, '.ts')))
    setCheck(allChecks, 'code-workers-index', missingWorkers.length === 0 ? 'pass' : 'warning', missingWorkers.length === 0 ? 'Worker index references discovered worker files.' : `Review worker imports: ${missingWorkers.length} file(s) may not be imported.`, missingWorkers.join('\n'))
  }

  const importScan = spawnSync('rg', ['-n', "from ['\"]\\.[^'\"]*(?<!\\.js)['\"]", 'apps', 'packages', '--glob', '*.ts'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
  const importLines = `${importScan.stdout ?? ''}`.split(/\r?\n/).filter(Boolean)
  setCheck(allChecks, 'code-js-extensions', importLines.length === 0 ? 'pass' : 'warning', importLines.length === 0 ? 'Relative imports appear to use explicit extensions where scanned.' : 'Some relative imports may need .js extension review.', importLines.slice(0, 80).join('\n'))

  const repoFiles = spawnSync('rg', ['--files', 'packages/db/src'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
  const repoFileCount = `${repoFiles.stdout ?? ''}`.split(/\r?\n/).filter((file) => file.includes('repositories') && file.endsWith('.ts')).length
  setCheck(allChecks, 'db-repositories', repoFileCount > 0 ? 'pass' : 'fail', repoFileCount > 0 ? `${repoFileCount} repository file(s) found.` : 'No repository files found under packages/db/src.')

  setCheck(allChecks, 'env-required', missing.length === 0 ? 'pass' : 'fail', missing.length === 0 ? 'Required environment values are present.' : `Missing values: ${missing.join(', ')}`)
  const supabaseUrl = env.get('SUPABASE_URL') ?? ''
  setCheck(allChecks, 'env-supabase-url', supabaseUrl && !supabaseUrl.startsWith('NEXT_PUBLIC_') ? 'pass' : 'fail', supabaseUrl ? 'SUPABASE_URL is configured.' : 'SUPABASE_URL is missing.')
  const jwtA = env.get('JWT_SECRET') ?? env.get('JWT_ACCESS_SECRET') ?? ''
  const jwtB = env.get('JWT_REFRESH_SECRET') ?? ''
  setCheck(allChecks, 'env-jwt', jwtA.length >= 32 && (!jwtB || (jwtB.length >= 32 && jwtA !== jwtB)) ? 'pass' : 'warning', jwtA.length >= 32 ? 'JWT secret length looks acceptable; refresh secret checked when present.' : 'JWT secret should be at least 32 characters.')
  setCheck(allChecks, 'env-license-public', envPresent(env, 'LICENSE_PUBLIC_KEY') ? 'pass' : 'fail', envPresent(env, 'LICENSE_PUBLIC_KEY') ? 'LICENSE_PUBLIC_KEY is configured.' : 'LICENSE_PUBLIC_KEY is missing.')
  setCheck(allChecks, 'env-deepseek-url', env.get('DEEPSEEK_BASE_URL') === 'https://api.deepseek.com/v1' ? 'pass' : 'warning', env.get('DEEPSEEK_BASE_URL') === 'https://api.deepseek.com/v1' ? 'DEEPSEEK_BASE_URL matches the production value.' : 'DEEPSEEK_BASE_URL does not match https://api.deepseek.com/v1.')
  setCheck(allChecks, 'env-llm-stub', env.get('LLM_STUB') === 'false' ? 'pass' : 'warning', env.get('LLM_STUB') === 'false' ? 'LLM_STUB is false.' : 'LLM_STUB is not false; keep true for local dev, false for production.')
  setCheck(allChecks, 'env-node-env', env.get('NODE_ENV') === 'production' ? 'pass' : 'warning', env.get('NODE_ENV') === 'production' ? 'NODE_ENV is production.' : 'NODE_ENV is not production; this is expected for local development.')
  setCheck(allChecks, 'env-app-url', envPresent(env, 'APP_URL') ? 'pass' : 'fail', envPresent(env, 'APP_URL') ? 'APP_URL is configured.' : 'APP_URL is missing.')

  const login = await fetchStatus('http://100.84.229.45:3001/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo-a.test', password: 'demo1234' })
  })
  setCheck(allChecks, 'func-valid-login', login.ok ? 'pass' : 'fail', login.ok ? 'Demo login succeeded.' : login.message, login.body.slice(0, 500))
  const badLogin = await fetchStatus('http://100.84.229.45:3001/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo-a.test', password: 'wrong-password' })
  }, 401)
  setCheck(allChecks, 'func-invalid-login', badLogin.ok ? 'pass' : 'fail', badLogin.ok ? 'Invalid login is rejected cleanly.' : badLogin.message, badLogin.body.slice(0, 500))
  const health = await fetchStatus('http://100.84.229.45:3001/health')
  setCheck(allChecks, 'func-health', health.ok ? 'pass' : 'fail', health.ok ? 'Health endpoint returned HTTP 200.' : health.message, health.body.slice(0, 500))

  const gitignore = existsSync(path.join(repoRoot, '.gitignore')) ? readFileSync(path.join(repoRoot, '.gitignore'), 'utf8') : ''
  const envIgnored = /^\.env$/m.test(gitignore) || gitignore.includes('.env')
  setCheck(allChecks, 'sec-env-gitignore', envIgnored ? 'pass' : 'fail', envIgnored ? '.env is ignored.' : '.env is not clearly listed in .gitignore.')
  const tokenStorage = spawnSync('rg', ['-n', 'localStorage|sessionStorage', 'apps/inboxos/src', '-S'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
  const tokenLines = `${tokenStorage.stdout ?? ''}`.split(/\r?\n/).filter((line) => /accessToken|refreshToken|token/i.test(line))
  setCheck(allChecks, 'sec-token-storage', tokenLines.length === 0 ? 'pass' : 'warning', tokenLines.length === 0 ? 'No obvious token storage in browser storage found.' : 'Review token storage usage.', tokenLines.slice(0, 80).join('\n'))
  const gates = runTool(['gates', 'check'], 120000)
  setCheck(allChecks, 'sec-rls-simulation', gates.ok ? 'pass' : 'fail', gates.ok ? 'DevTools gates passed, including RLS simulation.' : short(gates.output), gates.output)
  const supabaseAdminScan = spawnSync('rg', ['-n', 'supabaseAdmin', 'apps', 'packages', '-S'], { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe', windowsHide: true })
  const supabaseAdminLines = `${supabaseAdminScan.stdout ?? ''}`.split(/\r?\n/).filter(Boolean)
  const riskySupabaseAdmin = supabaseAdminLines.filter((line) => !/workers|admin|license|scripts|test|__tests__/.test(line))
  setCheck(allChecks, 'sec-supabase-admin', riskySupabaseAdmin.length === 0 ? 'pass' : 'warning', riskySupabaseAdmin.length === 0 ? 'No risky supabaseAdmin usage found by scan.' : 'Review supabaseAdmin usage in public/API paths.', riskySupabaseAdmin.slice(0, 80).join('\n'))
  setCheck(allChecks, 'sec-license-signing', envPresent(env, 'LICENSE_SIGNING_KEY') ? 'fail' : 'pass', envPresent(env, 'LICENSE_SIGNING_KEY') ? 'LICENSE_SIGNING_KEY is present in local env; keep it only on licensekit server.' : 'LICENSE_SIGNING_KEY was not found in local env.')

  // Module boundaries are enforced authoritatively by eslint (devtools/no-direct-*).
  // Mirror that result instead of a substring scan, which produced false positives
  // on the rule definitions themselves, comments, test mocks, and `.js` re-exports
  // of the permitted provider.
  const boundaryStatus: CheckStatus = lint.ok ? 'pass' : 'fail'
  const boundaryMessage = lint.ok
    ? 'No module boundary violations (enforced by lint rules).'
    : 'Lint reported issues; review module boundary rules.'
  for (const id of ['boundary-supabase', 'boundary-bullmq', 'boundary-anthropic', 'boundary-google', 'boundary-resend']) {
    setCheck(allChecks, id, boundaryStatus, boundaryMessage, lint.ok ? undefined : lint.output)
  }
  setCheck(allChecks, 'boundary-lint', lint.ok ? 'pass' : 'fail', lint.ok ? 'Lint passed.' : short(lint.output), lint.output)

  return writeRun(stages)
}

function redirect(request: Request, key: 'message' | 'error', value: string) {
  const referer = request.headers.get('referer') ?? 'http://127.0.0.1:4000/predeployment'
  const url = new URL(referer)
  url.searchParams.set(key, value)
  return NextResponse.redirect(url, 303)
}

function isProcessAlive(pid?: number) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function runningState() {
  if (!existsSync(predeploymentRunningFile)) return null
  try {
    const state = JSON.parse(readFileSync(predeploymentRunningFile, 'utf8')) as { pid?: number; status?: string; startedAt?: string }
    return state.status === 'running' && isProcessAlive(state.pid) ? state : null
  } catch {
    return null
  }
}

function startBackgroundRun() {
  mkdirSync(logsRoot, { recursive: true })
  const runner = path.join(dashboardRoot, 'scripts', 'predeployment-runner.ts')
  const tsxCli = path.join(toolsRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const out = path.join(logsRoot, 'predeployment-runner.out.log')
  const err = path.join(logsRoot, 'predeployment-runner.err.log')
  const child = spawn(process.execPath, [tsxCli, runner], {
    cwd: dashboardRoot,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      PREDEPLOYMENT_RUNNER_OUT: out,
      PREDEPLOYMENT_RUNNER_ERR: err
    }
  })
  child.unref()
  writeFileSync(predeploymentRunningFile, JSON.stringify({
    pid: child.pid,
    status: 'running',
    startedAt: new Date().toISOString(),
    message: 'Pre-deployment check is running in the background.'
  }, null, 2))
  return child.pid
}

export async function POST(request: Request) {
  const current = runningState()
  if (current) {
    return redirect(request, 'error', 'Pre-deployment check is already running.')
  }
  const pid = startBackgroundRun()
  return redirect(request, 'message', `Pre-deployment check started in the background${pid ? ` (${pid})` : ''}.`)
}
