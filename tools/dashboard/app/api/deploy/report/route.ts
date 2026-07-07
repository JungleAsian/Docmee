import fs from 'node:fs'
import path from 'node:path'
import { NextResponse } from 'next/server'

const toolsRoot = path.resolve(process.cwd(), '..')
const logsRoot = path.join(toolsRoot, 'logs')
const envFile = path.join(toolsRoot, '.env.tools')

export const dynamic = 'force-dynamic'

type CheckStatus = 'pass' | 'warning' | 'fail'
type PostDeploymentRun = {
  id?: string
  createdAt: string
  summary: { pass: number; warning: number; fail: number }
  checks: Array<{ name: string; status: CheckStatus; message: string; detail?: string; rawBody?: string }>
  target?: 'local' | 'vps'
}
type DeployLock = {
  action?: string
  createdAt?: string
}
type PhaseState = {
  id: string
  status?: string
}
type BuildRun = {
  phase?: string
  status?: string
  message?: string
}

function readJson<T>(file: string, fallback: T): T {
  const target = path.join(logsRoot, file)
  if (!fs.existsSync(target)) return fallback
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8')) as T
  } catch {
    return fallback
  }
}

function parseEnv() {
  if (!fs.existsSync(envFile)) return {} as Record<string, string>
  return Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).filter((line) => line.includes('=')).map((line) => {
    const index = line.indexOf('=')
    return [line.slice(0, index), line.slice(index + 1)]
  }))
}

function publicAppUrl(env: Record<string, string>) {
  const selected = env.PUBLIC_URL_MODE === 'ngrok'
    ? env.NGROK_URL
    : env.PUBLIC_URL_MODE === 'domain'
      ? env.PERMANENT_DOMAIN_URL || env.VPS_DOMAIN
      : env.APP_URL
  return (selected || env.APP_URL || '').replace(/\/$/, '')
}

function safe(value: string | undefined) {
  if (!value) return ''
  return value
    .replace(/"accessToken"\s*:\s*"[^"]+"/g, '"accessToken":"[redacted]"')
    .replace(/"refreshToken"\s*:\s*"[^"]+"/g, '"refreshToken":"[redacted]"')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]')
    .replace(/(password|token|secret|key)\s*[:=]\s*([^\s,;"']+)/gi, '$1=[redacted]')
    .slice(0, 1200)
}

function markdownCell(value: string | undefined) {
  return safe(value).replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|')
}

function statusLabel(status: CheckStatus) {
  if (status === 'pass') return 'Passed'
  if (status === 'warning') return 'Warning'
  return 'Issue'
}

function formatDate(value: string | undefined) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-US', { timeZone: 'America/New_York' })
}

function filenameDate() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function GET() {
  const env = parseEnv()
  const appUrl = publicAppUrl(env)
  const runs = readJson<PostDeploymentRun[]>('post-deployment.json', [])
  const latestSuccessfulVps = runs.find((run) => run.target === 'vps' && run.summary.fail === 0)
  const deployLock = readJson<DeployLock>('deploy-lock.json', {})
  const phases = readJson<PhaseState[]>('phases.json', [])
  const buildRun = readJson<BuildRun>('build-run.json', {})

  if (!latestSuccessfulVps) {
    return NextResponse.json(
      { error: 'No successful VPS deployment verification is available yet. Run Verify VPS Deployment first.' },
      { status: 404 }
    )
  }

  const completedPhases = phases.filter((phase) => phase.status === 'done').length
  const totalPhases = phases.length || 19
  const generatedAt = new Date().toISOString()
  const mode = env.PUBLIC_URL_MODE === 'domain' ? 'Permanent domain' : env.PUBLIC_URL_MODE === 'ngrok' ? 'Temporary ngrok' : 'Configured APP_URL'
  const checkRows = latestSuccessfulVps.checks.map((check) => {
    return `| ${markdownCell(check.name)} | ${statusLabel(check.status)} | ${markdownCell(check.message)} | ${markdownCell(check.detail)} |`
  }).join('\n')
  const markdown = `# Docmee VPS Deployment Report

Status: Successful
Generated: ${formatDate(generatedAt)}
Verified: ${formatDate(latestSuccessfulVps.createdAt)}

## Access

- Application: ${appUrl ? `${appUrl}/login` : 'Not configured'}
- Public URL mode: ${mode}
- Demo email: admin@demo-a.test
- Password: not included in this report. Use the issued one-time password and rotate it after first login.

## Deployment Summary

- Passed checks: ${latestSuccessfulVps.summary.pass}
- Warnings: ${latestSuccessfulVps.summary.warning}
- Issues: ${latestSuccessfulVps.summary.fail}
- Deployment requested: ${formatDate(deployLock.createdAt)}
- Current phase: ${buildRun.phase || phases.find((phase) => phase.status === 'in-progress')?.id || 'Not recorded'}
- Phase progress: ${completedPhases}/${totalPhases} complete

## VPS Configuration

- VPS host: ${env.VPS_HOST || 'Not configured'}
- VPS user: ${env.VPS_USER || 'Not configured'}
- Deploy path: ${env.VPS_DEPLOY_PATH || 'Not configured'}
- VPS domain: ${env.VPS_DOMAIN || 'Not configured'}
- APP_URL: ${env.APP_URL || 'Not configured'}
- Ngrok URL: ${env.NGROK_URL || 'Not configured'}
- Permanent domain URL: ${env.PERMANENT_DOMAIN_URL || 'Not configured'}

## Verification Checks

| Check | Status | Result | Details |
| --- | --- | --- | --- |
${checkRows}

## Notes

- Deployment is marked successful automatically when the latest VPS verification has zero issues.
- Secrets, tokens, SSH keys, and one-time passwords are intentionally excluded.
- Save this report with the deployment record before switching from ngrok to the permanent domain.
`

  return new NextResponse(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="docmee-vps-deployment-report-${filenameDate()}.md"`,
      'Cache-Control': 'no-store'
    }
  })
}
