import fs from 'node:fs'
import path from 'node:path'
import { StatusDot } from '../status-dot'
import { DetailButton } from '../detail-button'
import { AutoRefresh } from '../auto-refresh'
import { VerifyFlowStrip } from '../verify-flow-strip'
import { LaneItemGauge } from '../lane-item-gauge'
import { BuildProgressGauge } from '../build-progress-gauge'

const toolsRoot = path.resolve(process.cwd(), '..')
const predeploymentFile = path.join(toolsRoot, 'logs', 'predeployment.json')
const predeploymentRunningFile = path.join(toolsRoot, 'logs', 'predeployment-running.json')

type CheckStatus = 'not-run' | 'pass' | 'warning' | 'fail' | 'manual'
type CheckSource = 'Automated' | 'Manual' | 'External service' | 'Gated action'
type PredeploymentCheck = {
  id: string
  name: string
  source: CheckSource
  status: CheckStatus
  message?: string
  detail?: string
}
type PredeploymentStage = {
  id: string
  title: string
  description?: string
  checks: PredeploymentCheck[]
}
type PredeploymentRun = {
  id: string
  createdAt: string
  summary: Record<CheckStatus, number>
  stages: PredeploymentStage[]
}
type RunningState = {
  pid?: number
  status?: 'running' | 'failed'
  startedAt?: string
  finishedAt?: string
  message?: string
}
type PageProps = { searchParams?: { message?: string; error?: string } }

const plannedStages: PredeploymentStage[] = [
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

function auto(id: string, name: string): PredeploymentCheck {
  return { id, name, source: 'Automated', status: 'not-run' }
}

function manual(id: string, name: string): PredeploymentCheck {
  return { id, name, source: 'Manual', status: 'manual', message: 'Requires user confirmation or third-party console verification.' }
}

function gated(id: string, name: string): PredeploymentCheck {
  return { id, name, source: 'Gated action', status: 'manual', message: 'Requires explicit deployment confirmation before automation.' }
}

function readRuns() {
  if (!fs.existsSync(predeploymentFile)) return [] as PredeploymentRun[]
  try {
    return JSON.parse(fs.readFileSync(predeploymentFile, 'utf8')) as PredeploymentRun[]
  } catch {
    return [] as PredeploymentRun[]
  }
}

function readRunning() {
  if (!fs.existsSync(predeploymentRunningFile)) return null as RunningState | null
  try {
    const state = JSON.parse(fs.readFileSync(predeploymentRunningFile, 'utf8')) as RunningState
    return state.status === 'running' || state.status === 'failed' ? state : null
  } catch {
    return null
  }
}

function statusLabel(status: CheckStatus) {
  if (status === 'not-run') return 'Not checked'
  if (status === 'pass') return 'Passed'
  if (status === 'warning') return 'Warning'
  if (status === 'fail') return 'Failed'
  return 'Manual'
}

function statusDotTone(status: CheckStatus) {
  if (status === 'pass') return 'green' as const
  if (status === 'warning') return 'amber' as const
  if (status === 'fail') return 'red' as const
  if (status === 'manual') return 'sky' as const
  return 'slate' as const
}

function latestStages(latest?: PredeploymentRun) {
  if (!latest) return plannedStages
  const checked = new Map<string, PredeploymentCheck>()
  for (const stage of latest.stages) {
    for (const check of stage.checks) checked.set(check.id, check)
  }
  return plannedStages.map((stage) => ({
    ...stage,
    checks: stage.checks.map((check) => checked.get(check.id) ?? check)
  }))
}

export default function PredeploymentPage({ searchParams }: PageProps) {
  const runs = readRuns()
  const running = readRunning()
  const latest = runs[0]
  const stages = latestStages(latest)
  const summary = latest?.summary ?? { 'not-run': stages.flatMap((stage) => stage.checks).filter((check) => check.status === 'not-run').length, pass: 0, warning: 0, fail: 0, manual: stages.flatMap((stage) => stage.checks).filter((check) => check.status === 'manual').length }
  const blockers = stages.flatMap((stage) => stage.checks.map((check) => ({ ...check, stage: stage.title }))).filter((check) => check.status === 'fail')

  const totalChecks = summary.pass + summary.warning + summary.fail + summary.manual + summary['not-run']
  const overallPercent = totalChecks > 0 ? (summary.pass / totalChecks) * 100 : 0
  const overallState: 'complete' | 'progressing' | 'halted' | 'stopped' =
    summary.fail > 0 ? 'halted' : summary.pass === totalChecks && totalChecks > 0 ? 'complete' : summary.pass + summary.warning === 0 ? 'stopped' : 'progressing'

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Pre-deployment</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Deployment readiness checklist from Notion. The run button performs safe checks only; VPS changes, webhook setup,
            production migration, and external service confirmations stay manual until separately approved.
          </p>
        </div>
      </div>

      <AutoRefresh seconds={15} />
      <div className="mt-3">
        <VerifyFlowStrip active="predeploy" />
      </div>

      {searchParams?.message && <p className="mt-3 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && <p className="mt-3 text-sm text-red-300">{searchParams.error}</p>}
      {running?.status === 'running' && (
        <div className="mt-4 rounded-md border border-cyan-800 bg-cyan-950/30 p-4 text-sm text-cyan-100">
          <div className="font-semibold">Pre-deployment check is running in the background.</div>
          <div className="mt-1 text-cyan-200/80">
            Started {running.startedAt ? new Date(running.startedAt).toLocaleString() : 'recently'}
            {running.pid ? ` · process ${running.pid}` : ''}
          </div>
          <div className="mt-2 text-xs text-cyan-200/70">The dashboard stays usable while checks continue. Results appear here after auto refresh.</div>
        </div>
      )}
      {running?.status === 'failed' && (
        <div className="mt-4 rounded-md border border-red-800 bg-red-950/30 p-4 text-sm text-red-100">
          <div className="font-semibold">Last background check failed before it could finish.</div>
          {running.message && <div className="mt-1 text-red-100/80">{running.message}</div>}
        </div>
      )}

      <div className="mt-4 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <BuildProgressGauge
            size="md"
            percent={overallPercent}
            state={overallState}
            label="Pre-deployment"
            message={`${summary.pass} pass · ${summary.fail} fail`}
          />
          <form action="/api/predeployment/run" method="post">
            <button
              disabled={running?.status === 'running'}
              className="min-h-11 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {running?.status === 'running' ? 'Check Running' : 'Run Pre-deployment Check'}
            </button>
          </form>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <SummaryCard label="Last run" value={latest ? new Date(latest.createdAt).toLocaleString() : 'Not run yet'} />
          <SummaryCard label="Passed" value={String(summary.pass)} tone="emerald" />
          <SummaryCard label="Warnings" value={String(summary.warning)} tone="amber" />
          <SummaryCard label="Failed" value={String(summary.fail)} tone="red" />
          <SummaryCard label="Manual" value={String(summary.manual)} tone="sky" />
        </div>

        {blockers.length > 0 && (
          <div className="mt-4 rounded-md border border-red-800 bg-red-950/30 p-4">
            <h2 className="text-sm font-semibold text-red-200">Blockers</h2>
            <div className="mt-3 grid gap-2">
              {blockers.map((check) => (
                <div key={check.id} className="rounded border border-red-900/80 bg-slate-950/30 p-3">
                  <div className="text-sm font-medium text-red-100">{check.name}</div>
                  <div className="mt-1 text-xs text-red-200/80">{check.stage}</div>
                  {check.message && <p className="mt-2 text-sm text-red-100">{check.message}</p>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-4">
        {stages.map((stage) => {
          const failed = stage.checks.filter((check) => check.status === 'fail').length
          const warnings = stage.checks.filter((check) => check.status === 'warning').length
          const passed = stage.checks.filter((check) => check.status === 'pass').length
          const manualCount = stage.checks.filter((check) => check.status === 'manual').length
          const total = stage.checks.length
          const stagePercent = total > 0 ? (passed / total) * 100 : 0
          const stageTone = failed > 0 ? 'red' : warnings > 0 ? 'amber' : passed > 0 ? 'emerald' : 'slate'
          return (
            <details key={stage.id} className="rounded-md border border-slate-800 bg-slate-900">
              <summary className="flex cursor-pointer select-none items-center gap-3 px-4 py-3">
                <LaneItemGauge percent={stagePercent} tone={stageTone} title={stage.title} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{stage.title}</span>
                  <span className={failed > 0 ? 'text-xs text-red-300' : warnings > 0 ? 'text-xs text-amber-300' : passed > 0 ? 'text-xs text-emerald-300' : 'text-xs text-slate-400'}>
                    {passed}/{total} passed · {warnings} warnings · {failed} failed · {manualCount} manual
                  </span>
                </span>
              </summary>
              <div className="grid gap-2 border-t border-slate-800 p-4">
                {stage.checks.map((check) => (
                  <div key={check.id} className="rounded border border-slate-800 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm text-slate-200">{check.name}</span>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400">{check.source}</span>
                        <StatusDot tone={statusDotTone(check.status)} label={statusLabel(check.status)} />
                      </div>
                    </div>
                    {check.message && <p className="mt-2 text-xs text-slate-400">{check.message}</p>}
                    {check.detail && (
                      <div className="mt-2"><DetailButton buttonLabel="View details" title={check.name} body={check.detail} /></div>
                    )}
                  </div>
                ))}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'amber' | 'red' | 'sky' }) {
  const toneClass = tone === 'emerald'
    ? 'border-emerald-800 bg-emerald-950/20 text-emerald-200'
    : tone === 'amber'
      ? 'border-amber-800 bg-amber-950/20 text-amber-200'
      : tone === 'red'
        ? 'border-red-800 bg-red-950/20 text-red-200'
        : tone === 'sky'
          ? 'border-sky-800 bg-sky-950/20 text-sky-200'
          : 'border-slate-800 bg-slate-900 text-slate-200'
  return (
    <div className={`rounded-md border p-4 ${toneClass}`}>
      <div className="text-xs opacity-75">{label}</div>
      <div className="mt-2 break-words text-lg font-semibold">{value}</div>
    </div>
  )
}
