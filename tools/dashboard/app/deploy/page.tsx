import fs from 'node:fs'
import path from 'node:path'
import { CompactSection, SimpleStatusCard } from '../compact-ui'
import { DeployActionButton } from './deploy-action-button'
import { ResetDeploymentButton } from './reset-deployment-button'
import { DeployEverythingPanel } from '../deploy-everything-panel'
import { WorkflowStages } from '../workflow-stages'
import { BuildProgressGauge } from '../build-progress-gauge'
import { AutoRefresh } from '../auto-refresh'

const toolsRoot = path.resolve(process.cwd(), '..')
const repoRoot = path.resolve(toolsRoot, '..')
const envFile = path.join(toolsRoot, '.env.tools')
// The Docmee app env lives at the repo root — prefer a real file, fall back to the template.
function resolveAppEnvFile() {
  for (const name of ['.env.production', '.env', '.env.example']) {
    const candidate = path.join(repoRoot, name)
    if (fs.existsSync(candidate)) return candidate
  }
  return path.join(repoRoot, '.env.example')
}
const appEnvFile = resolveAppEnvFile()
const postDeploymentFile = path.join(toolsRoot, 'logs', 'post-deployment.json')
const phasesFile = path.join(toolsRoot, 'logs', 'phases.json')
const deployLockFile = path.join(toolsRoot, 'logs', 'deploy-lock.json')
const deployLogFile = path.join(toolsRoot, 'logs', `deploy-${new Date().toISOString().slice(0, 10)}.log`)

function parseEnv() {
  if (!fs.existsSync(envFile)) return {}
  return Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((line) => line.includes('=')).map((line) => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
}

type PageProps = { searchParams?: { message?: string; error?: string } }
type CheckStatus = 'pass' | 'warning' | 'fail'
type PhaseStatus = 'not-started' | 'in-progress' | 'done'
type PostDeploymentRun = {
  id?: string
  createdAt: string
  summary: { pass: number; warning: number; fail: number }
  checks: Array<{ name: string; status: CheckStatus; message: string; detail?: string }>
  target?: 'local' | 'vps' | 'env'
}
type PhaseState = {
  id: string
  status: PhaseStatus
}
type DeployLock = {
  action?: string
  createdAt?: string
}

const deploymentPhases = [
  {
    label: 'Phase 1 MVP Deployment',
    scope: 'Core clinic launch',
    phaseIds: ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P19'],
    description: 'Foundation, database, AI, WhatsApp, clinic inbox, licensing, voice transcription, compliance, and launch readiness.'
  },
  {
    label: 'Phase 2 Expansion Deployment',
    scope: 'Channel and installer expansion',
    phaseIds: ['P13', 'P14', 'P15', 'P16', 'P17'],
    description: 'DeployKit, Facebook Messenger, Instagram Direct, Phase 2 feature set, testing, and CI/CD.'
  },
  {
    label: 'Phase 3 Advanced Features Deployment',
    scope: 'Advanced feature rollout',
    phaseIds: ['P18'],
    description: 'Phase 3 feature package after MVP and expansion are stable.'
  }
] as const

function readPostDeploymentRuns() {
  if (!fs.existsSync(postDeploymentFile)) return [] as PostDeploymentRun[]
  try {
    return JSON.parse(fs.readFileSync(postDeploymentFile, 'utf8')) as PostDeploymentRun[]
  } catch {
    return []
  }
}

function readPhases() {
  if (!fs.existsSync(phasesFile)) return [] as PhaseState[]
  try {
    return JSON.parse(fs.readFileSync(phasesFile, 'utf8')) as PhaseState[]
  } catch {
    return []
  }
}

function readDeployLock() {
  if (!fs.existsSync(deployLockFile)) return undefined
  try {
    return JSON.parse(fs.readFileSync(deployLockFile, 'utf8')) as DeployLock
  } catch {
    return undefined
  }
}

function latestPreflightPassed() {
  if (!fs.existsSync(deployLogFile)) return false
  const lines = fs.readFileSync(deployLogFile, 'utf8').trim().split(/\r?\n/).reverse()
  const latest = lines.find((line) => line.includes('Preflight passed') || line.includes('Preflight found'))
  return Boolean(latest?.includes('Preflight passed'))
}

function checkStatus(run: PostDeploymentRun | undefined, name: string) {
  return run?.checks.find((check) => check.name === name)
}

function statusClass(status?: CheckStatus) {
  if (status === 'pass') return 'text-emerald-300'
  if (status === 'warning') return 'text-amber-300'
  if (status === 'fail') return 'text-red-300'
  return 'text-slate-400'
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'check'
}

function detailHref(run: PostDeploymentRun | undefined, checkName?: string) {
  if (!run) return '/post-deployment'
  const runId = run.id ?? run.createdAt
  const params = new URLSearchParams({ run: runId })
  if (checkName) params.set('check', slug(checkName))
  return `/post-deployment?${params.toString()}#${checkName ? `check-${slug(runId)}-${slug(checkName)}` : `run-${slug(runId)}`}`
}

function publicAppUrl(env: Record<string, string>) {
  const selected = env.PUBLIC_URL_MODE === 'ngrok'
    ? env.NGROK_URL
    : env.PUBLIC_URL_MODE === 'domain'
      ? env.PERMANENT_DOMAIN_URL || env.VPS_DOMAIN
      : env.APP_URL
  return selected || env.APP_URL || ''
}

export default function DeployPage({ searchParams }: PageProps) {
  const env = parseEnv()
  const postDeploymentRuns = readPostDeploymentRuns()
  const latestLocal = postDeploymentRuns.find((run) => run.target !== 'vps' && run.target !== 'env')
  const latestVps = postDeploymentRuns.find((run) => run.target === 'vps')
  const latestEnv = postDeploymentRuns.find((run) => run.target === 'env' || run.checks.some((check) => check.name === 'Production env readiness'))
  const deployLock = readDeployLock()
  const phaseStates = readPhases()
  const phaseStatus = new Map(phaseStates.map((phase) => [phase.id, phase.status]))
  const vpsReady = Boolean(env.VPS_HOST && env.VPS_USER && env.VPS_SSH_KEY_PATH && env.VPS_DEPLOY_PATH)
  const publicMode = env.PUBLIC_URL_MODE === 'domain' ? 'Permanent domain' : 'Temporary ngrok'
  const runtimeChecked = Boolean(latestLocal)
  const runtimeReady = Boolean(latestLocal && latestLocal.summary.fail === 0)
  const envChecked = Boolean(latestEnv)
  const envReady = Boolean(latestEnv && latestEnv.summary.fail === 0)
  const vpsChecked = Boolean(latestVps)
  const vpsVerified = Boolean(latestVps && latestVps.summary.fail === 0)
  const appUrl = publicAppUrl(env).replace(/\/$/, '')
  // URL to reach the deployed Docmee panel: the public URL, else the VPS host:3000.
  const docmeeUrl = appUrl || (env.VPS_HOST ? `http://${env.VPS_HOST}:3000` : '')
  const vpsRuntimeChecked = checkStatus(latestVps, 'VPS runtime status')?.status === 'pass'
  const phase1 = deploymentPhases[0]
  const phase1Ready = phase1.phaseIds.every((id) => phaseStatus.get(id) === 'done')
  const runtimeDependencies = [
    ['Docker engine', 'Runs local Postgres and Redis containers.'],
    ['Postgres port', 'Database required for login and app data.'],
    ['Redis port', 'Queue/cache runtime used by background jobs.'],
    ['API health', 'Confirms the local API can respond.'],
    ['Demo login', 'Confirms seeded test credentials work.']
  ] as const
  const actions = [
    {
      action: 'post-deploy-check',
      label: 'Run Runtime Check',
      enabled: true,
      tone: 'primary',
      readyText: 'Available anytime',
      blockedText: ''
    },
    {
      action: 'env-readiness-check',
      label: 'Check .env Readiness',
      enabled: true,
      tone: 'primary',
      readyText: 'Checks Supabase, database, Redis, JWT, app URL, and VPS values',
      blockedText: ''
    },
    {
      action: 'deploy-local',
      label: 'Start Local',
      enabled: true,
      tone: 'secondary',
      readyText: 'Available anytime',
      blockedText: ''
    },
    {
      action: 'deploy-redis',
      label: 'Redis 7 Commands',
      enabled: true,
      tone: 'secondary',
      readyText: 'Reference commands only',
      blockedText: ''
    },
    {
      action: 'deploy-check',
      label: 'Check VPS',
      enabled: vpsReady,
      tone: 'secondary',
      readyText: 'VPS settings configured',
      blockedText: 'Fill VPS host, user, SSH key, and deploy path first'
    },
    {
      action: 'deploy-status',
      label: 'VPS Status',
      enabled: vpsReady,
      tone: 'secondary',
      readyText: 'VPS settings configured',
      blockedText: 'Run after VPS settings are complete'
    },
    {
      action: 'vps-post-deploy-check',
      label: 'Verify VPS Deployment',
      enabled: vpsReady,
      tone: 'primary',
      readyText: 'Checks deployed site, API, SSH, PM2, Redis, disk, and memory',
      blockedText: 'Fill VPS settings first'
    },
    {
      action: 'deploy-env',
      label: 'Sync .env',
      enabled: vpsReady && envReady,
      tone: 'secondary',
      readyText: '.env readiness and VPS settings configured',
      blockedText: !envChecked ? 'Run Check .env Readiness first' : !envReady ? 'Resolve .env readiness issues first' : 'Fill VPS settings first'
    },
    {
      action: 'deploy-preflight',
      label: 'Preflight VPS',
      enabled: vpsReady,
      tone: 'secondary',
      readyText: 'Validates .env.production keys, NODE_ENV=production, Redis ≥5, and the toolchain on the VPS — run before deploying',
      blockedText: 'Fill VPS settings first'
    },
    {
      action: 'deploy-vps',
      label: 'Deploy to VPS',
      enabled: vpsReady && runtimeReady && envReady && phase1Ready,
      tone: 'danger',
      readyText: 'Phase 1, runtime, .env, and VPS prerequisites passed',
      blockedText: !phase1Ready
        ? 'Complete Phase 1 MVP deployment phases first'
        : !runtimeChecked
          ? 'Run Runtime Check first'
          : !runtimeReady
            ? 'Resolve Runtime Check issues first'
            : !envChecked
              ? 'Run Check .env Readiness first'
              : !envReady
                ? 'Resolve .env readiness issues first'
                : 'Fill VPS settings first'
    },
    {
      action: 'deploy-rollback',
      label: 'Rollback',
      enabled: deployLock?.action === 'vps',
      tone: 'secondary',
      readyText: 'Available after a VPS deployment request',
      blockedText: 'Available after Deploy to VPS is requested'
    }
  ]
  // A passing VPS runtime check (SSH reaches the box and services/Redis respond) is
  // our proxy that the one-time provisioning (bootstrap + Redis + .env.production) is done.
  const vpsProvisioned = vpsRuntimeChecked
  const guideSteps = [
    {
      id: 'runtime',
      label: '1 · Check local runtime',
      action: 'post-deploy-check',
      complete: runtimeReady,
      ready: true,
      detail: runtimeChecked && !runtimeReady ? 'Resolve local runtime issues before VPS deployment.' : 'Confirms the local app, API, database, and Redis respond.'
    },
    {
      id: 'env',
      label: '2 · Check .env readiness',
      action: 'env-readiness-check',
      complete: envReady,
      ready: runtimeReady,
      detail: envChecked && !envReady ? 'Resolve .env issues before VPS sync or deploy.' : 'Checks production database, Redis, JWT, app URL, and VPS values without showing secrets.'
    },
    {
      id: 'vps-settings',
      label: '3 · Confirm VPS settings',
      action: 'deploy-check',
      complete: vpsReady,
      ready: true,
      detail: vpsReady ? 'SSH host, user, key, and deploy path are configured.' : 'Fill host, user, SSH key, and deploy path in Settings.'
    },
    {
      id: 'bootstrap',
      label: '4 · Bootstrap the VPS (one-time)',
      action: '',
      complete: vpsProvisioned,
      ready: vpsReady,
      detail: 'Run vps-bootstrap.sh as root, then add the printed GitHub deploy key and re-run. Installs Node 20, pnpm, pm2, caddy. See "VPS Provisioning" below.'
    },
    {
      id: 'redis',
      label: '5 · Install Redis ≥5 (one-time)',
      action: '',
      complete: vpsProvisioned,
      ready: vpsReady,
      detail: 'The bootstrap script does NOT install Redis. On Ubuntu 22.04+: apt-get install redis-server (ships Redis 6/7, satisfies BullMQ).'
    },
    {
      id: 'env-production',
      label: '6 · Create .env.production (one-time)',
      action: '',
      complete: vpsProvisioned,
      ready: vpsReady,
      detail: 'On the VPS: cp .env.example .env.production and fill the secrets. PM2 loads it into every app automatically (ecosystem.config.cjs).'
    },
    {
      id: 'vps-status',
      label: '7 · Check VPS runtime',
      action: 'deploy-status',
      complete: vpsRuntimeChecked,
      ready: vpsReady,
      detail: vpsRuntimeChecked ? 'SSH runtime confirmed: services, Redis, disk, and memory.' : 'Verifies the bootstrap + Redis through SSH.'
    },
    {
      id: 'preflight',
      label: '8 · Preflight VPS',
      action: 'deploy-preflight',
      complete: vpsProvisioned,
      ready: vpsReady,
      detail: 'Validates .env.production keys, NODE_ENV=production, Redis ≥5, and the toolchain on the VPS before deploying.'
    },
    {
      id: 'phases',
      label: '9 · Complete Phase 1',
      action: '',
      complete: phase1Ready,
      ready: runtimeReady,
      detail: 'Feature phases that must be done before a production deployment is requested.'
    },
    {
      id: 'deploy-request',
      label: '10 · Deploy to VPS',
      action: 'deploy-vps',
      complete: deployLock?.action === 'vps',
      ready: vpsReady && runtimeReady && envReady && phase1Ready,
      detail: 'Runs the remote pipeline: build → migrate → PM2 reload → health check.'
    },
    {
      id: 'vps-verify',
      label: '11 · Verify deployed app',
      action: 'vps-post-deploy-check',
      complete: vpsVerified,
      ready: vpsReady,
      detail: vpsChecked && !vpsVerified ? 'Latest VPS verification found issues. Recheck after fixing the VPS app/reverse proxy.' : 'Checks deployed login, inbox, API health, and SSH runtime.'
    }
  ]
  const nextGuideStep = guideSteps.find((step) => !step.complete && step.ready) ?? guideSteps.find((step) => !step.complete)
  const nextAction = nextGuideStep?.action
  const runtimeIssues = latestLocal?.checks.filter((check) => check.status === 'fail' || check.status === 'warning') ?? []
  const envIssues = latestEnv?.checks.filter((check) => check.name !== 'Production env readiness' && (check.status === 'fail' || check.status === 'warning')) ?? []
  const vpsIssues = latestVps?.checks.filter((check) => check.status === 'fail' || check.status === 'warning') ?? []
  const latestIssueRun = latestVps?.summary.fail ? latestVps : latestEnv?.summary.fail ? latestEnv : latestLocal?.summary.fail ? latestLocal : latestVps ?? latestEnv ?? latestLocal
  const latestIssue = latestIssueRun?.checks.find((check) => check.status === 'fail') ?? latestIssueRun?.checks.find((check) => check.status === 'warning')
  const verifiedVps = vpsVerified ? latestVps : undefined
  const stalePreflightError = Boolean(searchParams?.error?.startsWith('Preflight blocked') && latestPreflightPassed())

  // Overall deploy readiness reflected in the header gauge, derived only from
  // values already computed above (phase completion + run/issue signals).
  const allPhaseIds = deploymentPhases.flatMap((phase) => phase.phaseIds)
  const phasesTotal = allPhaseIds.length
  const phasesDone = allPhaseIds.filter((id) => phaseStatus.get(id) === 'done').length
  const deployPercent = phasesTotal > 0 ? Math.round((phasesDone / phasesTotal) * 100) : 0
  const hasBlockers = runtimeIssues.length > 0 || envIssues.length > 0 || vpsIssues.length > 0
  const deployInProgress = deployLock?.action === 'vps' && !vpsVerified
  const deployGaugeState: 'complete' | 'progressing' | 'halted' | 'stopped' = vpsVerified
    ? 'complete'
    : deployInProgress
      ? 'progressing'
      : hasBlockers
        ? 'halted'
        : 'stopped'

  return (
    <section className="w-full">
      <WorkflowStages active="deploy" />
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Deploy</h1>
          <p className="mt-2 text-sm text-slate-400">Local machine and VPS deployment controls.</p>
        </div>
        <BuildProgressGauge
          size="sm"
          percent={deployPercent}
          state={deployGaugeState}
          label="Deploy readiness"
          message={`${phasesDone}/${phasesTotal} phases`}
        />
      </div>
      {searchParams?.message && <p className="mt-2 text-sm text-emerald-300">{searchParams.message}</p>}
      {searchParams?.error && !stalePreflightError && !(envReady && /\.env|env /i.test(searchParams.error)) && (
        <a
          href={detailHref(latestIssueRun, latestIssue?.name)}
          className="mt-2 inline-flex rounded border border-red-800 bg-red-950/30 px-3 py-2 text-sm text-red-200 hover:bg-red-950/50"
        >
          {searchParams.error} · View details
        </a>
      )}

      <div className="mt-4">
        <DeployEverythingPanel />
      </div>

      {verifiedVps && (
        <div className="mt-4 rounded-md border border-emerald-700 bg-emerald-950/30 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-emerald-100">VPS Deployment Successful</h2>
              <p className="mt-2 text-sm text-emerald-100/80">
                All latest VPS checks passed: login, inbox, API health, and runtime status.
              </p>
              <p className="mt-1 text-xs text-emerald-200/70">
                Verified {new Date(verifiedVps.createdAt).toLocaleString()} · {verifiedVps.summary.pass} checks passed
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {appUrl && (
                <a href={`${appUrl}/login`} target="_blank" rel="noreferrer" className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400">
                  Open Application
                </a>
              )}
              <a href="/api/deploy/report" className="rounded-md border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-100 hover:bg-emerald-900/40">
                Export Full Report
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 rounded-md border border-cyan-800 bg-cyan-950/30 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-cyan-100">Deployment Guide</h2>
            <p className="mt-2 text-sm text-cyan-100/80">
              {nextGuideStep
                ? `Next: ${nextGuideStep.label}. ${nextGuideStep.detail}`
                : 'Deployment guide is complete.'}
            </p>
          </div>
          <span className="rounded bg-slate-950/40 px-3 py-1 text-xs text-cyan-100">
            {guideSteps.filter((step) => step.complete).length}/{guideSteps.length} complete
          </span>
        </div>
        <details className="mt-4 group">
          <summary className="cursor-pointer list-none text-xs text-cyan-200/80 hover:text-cyan-100">
            <span className="group-open:hidden">Show all steps</span>
            <span className="hidden group-open:inline">Hide steps</span>
          </summary>
          <div className="mt-3 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {guideSteps.map((step, index) => (
            <div
              key={step.id}
              className={step.complete
                ? 'rounded border border-emerald-800 bg-emerald-950/30 p-3'
                : nextGuideStep?.id === step.id
                  ? 'rounded border border-cyan-300/50 bg-slate-950/40 p-3 deployment-next-step'
                  : step.ready
                    ? 'rounded border border-slate-700 bg-slate-950/40 p-3'
                    : 'rounded border border-slate-800 bg-slate-950/30 p-3 opacity-65'}
            >
              <div className="text-xs text-slate-500">Step {index + 1}</div>
              <div className="mt-1 text-sm font-medium text-slate-100">{step.label}</div>
              <div className={step.complete ? 'mt-2 text-xs text-emerald-300' : step.ready ? 'mt-2 text-xs text-cyan-300' : 'mt-2 text-xs text-slate-500'}>
                {step.complete ? 'Done' : step.ready ? 'Next action available' : 'Waiting for prerequisite'}
              </div>
            </div>
          ))}
          </div>
        </details>
      </div>

      <div className="mt-6">
      <CompactSection
        title="VPS Provisioning (one-time)"
        subtitle="Bare-server setup that must happen before the deploy buttons unlock. Run these once over SSH."
        badge={<span className={vpsProvisioned ? 'rounded bg-emerald-950 px-2 py-1 text-xs text-emerald-200' : 'rounded bg-amber-950 px-2 py-1 text-xs text-amber-200'}>{vpsProvisioned ? 'provisioned' : 'not provisioned'}</span>}
      >
        <ol className="space-y-4 text-sm text-slate-300">
          <li>
            <p className="font-medium text-slate-100">1 · Bootstrap (Node 20 / pnpm / pm2 / caddy + GitHub deploy key)</p>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-xs text-slate-300">{`ssh root@<vps> 'bash -s' < tools/deploy/setup/vps-bootstrap.sh`}</pre>
            <p className="mt-1 text-xs text-slate-500">It prints a public key — add it at the repo → Settings → Deploy keys (read-only is fine), then re-run the same command to finish cloning.</p>
          </li>
          <li>
            <p className="font-medium text-slate-100">2 · Install Redis ≥5 (the bootstrap script does NOT install it)</p>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-xs text-slate-300">{`ssh root@<vps> 'apt-get install -y redis-server && systemctl enable --now redis-server'`}</pre>
            <p className="mt-1 text-xs text-slate-500">Ubuntu 22.04+ ships Redis 6/7, which satisfies BullMQ. Required — the workers won&apos;t process jobs without it.</p>
          </li>
          <li>
            <p className="font-medium text-slate-100">3 · Create the production env (your secrets)</p>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 text-xs text-slate-300">{`cd ${env.VPS_DEPLOY_PATH || '/var/www/docmee'} && cp .env.example .env.production && nano .env.production`}</pre>
            <p className="mt-1 text-xs text-slate-500">Fill JWT_SECRET, JWT_REFRESH_SECRET, the database keys, and ANTHROPIC_API_KEY. PM2 loads it into every app automatically (ecosystem.config.cjs) and the deploy sources it before the build.</p>
          </li>
        </ol>
        <p className="mt-4 text-xs text-slate-500">After these three, run <span className="text-slate-300">Check VPS runtime</span> → <span className="text-slate-300">Preflight VPS</span>; the checks go green and the red <span className="text-slate-300">Deploy to VPS</span> button unlocks.</p>
      </CompactSection>
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-5">
        <SimpleStatusCard label="SSH connection" value={vpsReady ? 'Configured' : 'Missing'} tone={vpsReady ? 'emerald' : 'amber'} />
        <SimpleStatusCard label="Deploy path" value={env.VPS_DEPLOY_PATH || 'not set'} />
        <SimpleStatusCard label="Domain" value={env.VPS_DOMAIN || 'not set'} />
        <SimpleStatusCard label="Public URL mode" value={publicMode} />
        <SimpleStatusCard label="APP_URL" value={env.APP_URL ? 'Set' : 'not set'} detail={env.APP_URL || undefined} />
      </div>

      <div className="mt-6">
      <CompactSection title="Deployment Phases" subtitle="Rollout scope and phase completion. Open only when you need phase-level detail." badge={<span className={phase1Ready ? 'rounded bg-emerald-950 px-2 py-1 text-xs text-emerald-200' : 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-300'}>Phase 1 {phase1Ready ? 'ready' : 'not ready'}</span>}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Deployment Phases</h2>
            <p className="mt-2 text-sm text-slate-400">Choose the rollout scope before local validation or VPS deployment.</p>
          </div>
          <a href="/phases" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Open Phase Progress</a>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {deploymentPhases.map((phase) => {
            const done = phase.phaseIds.filter((id) => phaseStatus.get(id) === 'done').length
            const active = phase.phaseIds.some((id) => phaseStatus.get(id) === 'in-progress')
            const blocked = done < phase.phaseIds.length
            return (
              <div key={phase.label} className="rounded border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">{phase.label}</h3>
                    <p className="mt-1 text-xs text-slate-500">{phase.scope}</p>
                  </div>
                  <span className={blocked ? active ? 'rounded bg-amber-950 px-2 py-1 text-xs text-amber-200' : 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-300' : 'rounded bg-emerald-950 px-2 py-1 text-xs text-emerald-200'}>
                    {blocked ? active ? 'In progress' : 'Not ready' : 'Ready'}
                  </span>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">{phase.description}</p>
                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{done}/{phase.phaseIds.length} phases done</span>
                    <span>{Math.round((done / phase.phaseIds.length) * 100)}%</span>
                  </div>
                  <div className="mt-2 h-2 rounded bg-slate-800">
                    <div className="h-2 rounded bg-cyan-500" style={{ width: `${Math.round((done / phase.phaseIds.length) * 100)}%` }} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {phase.phaseIds.map((id) => {
                    const status = phaseStatus.get(id) ?? 'not-started'
                    return (
                      <span key={id} className={status === 'done' ? 'rounded bg-emerald-950 px-2 py-1 text-[11px] text-emerald-200' : status === 'in-progress' ? 'rounded bg-amber-950 px-2 py-1 text-[11px] text-amber-200' : 'rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-400'}>
                        {id}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </CompactSection>
      </div>

      <div className="mt-6 rounded-md border border-slate-800 bg-slate-900 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Deploy Actions</h2>
            <p className="mt-2 text-sm text-slate-400">Buttons unlock as prerequisite checks are completed.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className={runtimeReady ? 'rounded bg-emerald-950 px-2 py-1 text-emerald-200' : runtimeChecked ? 'rounded bg-red-950 px-2 py-1 text-red-200' : 'rounded bg-slate-800 px-2 py-1 text-slate-300'}>
              Runtime {runtimeReady ? 'ready' : runtimeChecked ? 'has issues' : 'not checked'}
            </span>
            <span className={envReady ? 'rounded bg-emerald-950 px-2 py-1 text-emerald-200' : envChecked ? 'rounded bg-red-950 px-2 py-1 text-red-200' : 'rounded bg-slate-800 px-2 py-1 text-slate-300'}>
              .env {envReady ? 'ready' : envChecked ? 'has issues' : 'not checked'}
            </span>
            <span className={vpsReady ? 'rounded bg-emerald-950 px-2 py-1 text-emerald-200' : 'rounded bg-amber-950 px-2 py-1 text-amber-200'}>
              VPS {vpsReady ? 'configured' : 'missing settings'}
            </span>
            <span className={phase1Ready ? 'rounded bg-emerald-950 px-2 py-1 text-emerald-200' : 'rounded bg-slate-800 px-2 py-1 text-slate-300'}>
              Phase 1 {phase1Ready ? 'ready' : 'not complete'}
            </span>
            <span className={vpsVerified ? 'rounded bg-emerald-950 px-2 py-1 text-emerald-200' : vpsChecked ? 'rounded bg-red-950 px-2 py-1 text-red-200' : 'rounded bg-slate-800 px-2 py-1 text-slate-300'}>
              VPS app {vpsVerified ? 'verified' : vpsChecked ? 'has issues' : 'not checked'}
            </span>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {actions.map((item) => (
            <form key={item.action} action="/api/actions" method="post" className="rounded border border-slate-800 bg-slate-950/40 p-3">
              <input type="hidden" name="action" value={item.action} />
              <DeployActionButton label={item.label} disabled={!item.enabled} tone={item.tone as 'primary' | 'secondary' | 'danger'} pulse={nextAction === item.action} />
              <p className={item.enabled ? 'mt-2 text-xs text-emerald-300' : 'mt-2 text-xs text-amber-300'}>
                {item.enabled ? item.readyText : item.blockedText}
              </p>
            </form>
          ))}
          {/* Open the deployed Docmee panel — only active once a VPS deployment is
              verified (the app is actually up and reachable). */}
          <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
            {vpsVerified && docmeeUrl ? (
              <a
                href={`${docmeeUrl}/login`}
                target="_blank"
                rel="noreferrer"
                className="block w-full rounded-md bg-emerald-600 px-3 py-2 text-center text-sm font-medium text-white hover:bg-emerald-500"
              >
                Open Docmee
              </a>
            ) : (
              <button type="button" disabled className="block w-full cursor-not-allowed rounded-md bg-slate-700 px-3 py-2 text-center text-sm font-medium text-slate-400">
                Open Docmee
              </button>
            )}
            <p className={vpsVerified && docmeeUrl ? 'mt-2 break-all text-xs text-emerald-300' : 'mt-2 text-xs text-amber-300'}>
              {!docmeeUrl
                ? 'Set APP_URL / VPS_DOMAIN or VPS_HOST first'
                : !vpsVerified
                  ? 'Available after a verified VPS deployment (run Verify VPS Deployment)'
                  : `Opens ${docmeeUrl} in a new tab`}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-6">
      <CompactSection title="Production .env Readiness" subtitle="Checks required setup values without showing tokens, passwords, or keys." badge={<span className={envReady ? 'rounded bg-emerald-950 px-2 py-1 text-xs text-emerald-200' : envChecked ? 'rounded bg-red-950 px-2 py-1 text-xs text-red-200' : 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-300'}>{envReady ? 'ready' : envChecked ? 'has issues' : 'not checked'}</span>}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Production .env Readiness</h2>
            <p className="mt-2 text-sm text-slate-400">Checks required setup values without showing tokens, passwords, or keys.</p>
            <p className="mt-2 text-xs text-slate-500">
              Reads the Docmee app env: <a href={`file://${appEnvFile.replace(/\\/g, '/')}`} className="break-all font-mono text-sky-300 hover:text-sky-200">{appEnvFile}</a>
            </p>
            <p className="mt-1 text-xs text-slate-500">
              VPS settings (VPS_*) come from <span className="break-all font-mono text-slate-300">{envFile}</span>; the VPS runs its own <span className="break-all font-mono text-slate-300">{(env.VPS_DEPLOY_PATH || '/var/www/docmee')}/.env.production</span>.
            </p>
          </div>
          <form action="/api/actions" method="post">
            <input type="hidden" name="action" value="env-readiness-check" />
            <DeployActionButton label="Check .env Readiness" tone="primary" pulse={nextAction === 'env-readiness-check'} />
          </form>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {['Production env readiness', 'DATABASE_URL', 'SUPABASE_URL', 'REDIS_URL', 'VPS settings'].map((name) => {
            const check = checkStatus(latestEnv, name)
            return (
              <div key={name} className="rounded border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-sm font-medium text-slate-200">{name}</div>
                <div className={`mt-1 text-sm ${statusClass(check?.status)}`}>{check?.status ?? 'not checked'}</div>
                <p className="mt-2 text-xs text-slate-500">{check?.message ?? 'Run the .env readiness check before VPS deployment.'}</p>
              </div>
            )
          })}
        </div>
        {latestEnv && (
          <p className="mt-3 text-xs text-slate-500">
            Last .env readiness check: {new Date(latestEnv.createdAt).toLocaleString()} ·{' '}
            {latestEnv.summary.fail > 0 || latestEnv.summary.warning > 0 ? (
              <a href={detailHref(latestEnv, envIssues[0]?.name ?? 'Production env readiness')} className="text-sky-300 hover:text-sky-200">
                {latestEnv.summary.fail} issue(s), {latestEnv.summary.warning} warning(s) · View details
              </a>
            ) : (
              `${latestEnv.summary.fail} issue(s)`
            )}
          </p>
        )}
      </CompactSection>
      </div>

      <div className="mt-6">
      <CompactSection title="Local Deployment Runtime" subtitle="Docker/Postgres/Redis/API/demo-login runtime checks." badge={<span className={runtimeReady ? 'rounded bg-emerald-950 px-2 py-1 text-xs text-emerald-200' : runtimeChecked ? 'rounded bg-red-950 px-2 py-1 text-xs text-red-200' : 'rounded bg-slate-800 px-2 py-1 text-xs text-slate-300'}>{runtimeReady ? 'ready' : runtimeChecked ? 'has issues' : 'not checked'}</span>}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Local Deployment Runtime</h2>
            <p className="mt-2 text-sm text-slate-400">These dependencies are required after the build and before VPS deployment.</p>
          </div>
          <a href="/post-deployment" className="rounded-md border border-slate-700 px-3 py-2 text-sm text-sky-300 hover:bg-slate-800">Open Post-Deployment Log</a>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {runtimeDependencies.map(([name, description]) => {
            const check = checkStatus(latestLocal, name)
            return (
              <div key={name} className="rounded border border-slate-800 bg-slate-950/40 p-3">
                <div className="text-sm font-medium text-slate-200">{name}</div>
                <div className={`mt-1 text-sm ${statusClass(check?.status)}`}>{check?.status ?? 'not checked'}</div>
                <p className="mt-2 text-xs text-slate-500">{check?.message ?? description}</p>
              </div>
            )
          })}
        </div>
        {latestLocal && (
          <p className="mt-3 text-xs text-slate-500">
            Last local runtime check: {new Date(latestLocal.createdAt).toLocaleString()} ·{' '}
            {latestLocal.summary.fail > 0 || latestLocal.summary.warning > 0 ? (
              <a href={detailHref(latestLocal, runtimeIssues[0]?.name)} className="text-sky-300 hover:text-sky-200">
                {latestLocal.summary.fail} issue(s), {latestLocal.summary.warning} warning(s) · View details
              </a>
            ) : (
              `${latestLocal.summary.fail} issue(s)`
            )}
          </p>
        )}
        {latestVps && (
          <p className="mt-1 text-xs text-slate-500">
            Last VPS verification: {new Date(latestVps.createdAt).toLocaleString()} ·{' '}
            {latestVps.summary.fail > 0 || latestVps.summary.warning > 0 ? (
              <a href={detailHref(latestVps, vpsIssues[0]?.name)} className="text-sky-300 hover:text-sky-200">
                {latestVps.summary.fail} issue(s), {latestVps.summary.warning} warning(s) · View details
              </a>
            ) : (
              `${latestVps.summary.fail} issue(s)`
            )}
          </p>
        )}
        {(runtimeIssues.length > 0 || envIssues.length > 0 || vpsIssues.length > 0) && (
          <div className="mt-4 rounded-md border border-red-900/70 bg-red-950/20 p-3">
            <h3 className="text-sm font-semibold text-red-100">Deployment Issues</h3>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {[...vpsIssues.map((check) => ({ run: latestVps, check, label: 'VPS' })), ...envIssues.map((check) => ({ run: latestEnv, check, label: '.env' })), ...runtimeIssues.map((check) => ({ run: latestLocal, check, label: 'Local' }))].map((item) => (
                <a
                  key={`${item.label}-${item.check.name}`}
                  href={detailHref(item.run, item.check.name)}
                  className="rounded border border-slate-800 bg-slate-950/40 p-3 text-sm hover:border-sky-700 hover:bg-slate-950/70"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-100">{item.check.name}</span>
                    <span className={item.check.status === 'fail' ? 'rounded bg-red-950 px-2 py-1 text-xs text-red-200' : 'rounded bg-amber-950 px-2 py-1 text-xs text-amber-200'}>
                      {item.label} {item.check.status === 'fail' ? 'Issue' : 'Warning'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{item.check.message}</p>
                  <p className="mt-2 text-xs text-sky-300">Open error details</p>
                </a>
              ))}
            </div>
          </div>
        )}
      </CompactSection>
      </div>

      <div className="mt-6">
      <CompactSection title="Service Layout" subtitle="Technical service map for the deployed app.">
        <h2 className="text-sm font-semibold">Service Layout</h2>
        <p className="mt-1 text-xs text-slate-500">PM2 processes defined in ecosystem.config.cjs.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {['docmee-api :3001', 'docmee-workers', 'docmee-inboxos :3000'].map((service) => <div key={service} className="rounded border border-slate-800 px-3 py-2 text-sm text-slate-300">{service}</div>)}
        </div>
        <p className="mt-2 text-xs text-slate-500">licensekit is a separate workspace and is not part of the PM2 deploy.</p>
      </CompactSection>
      </div>

      <div className="mt-6">
      <CompactSection title="Fresh Deployment Reset" subtitle="Advanced destructive reset area. Configuration and credentials are preserved.">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-red-100">Fresh Deployment Reset</h2>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Use this only when you want DevTools to look like a new deployment run. It archives and clears progress, checks, feature coverage, cost tracking, and run status while preserving configuration and credentials.
            </p>
          </div>
          <ResetDeploymentButton />
        </div>
      </CompactSection>
      </div>
    </section>
  )
}
