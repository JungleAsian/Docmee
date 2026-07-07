import fs from 'node:fs'
import { envToolsFile } from '../lib/paths.js'
import { httpProbe } from '../lib/net.js'
import type { SentinelConfig, TunnelMode } from '../config/schema.js'

export interface TunnelUrls {
  appUrl: string
  apiUrl: string
  devtoolsUrl: string
  webhookUrl: string
}

export interface VerifyResult {
  ok: boolean
  checks: Array<{ label: string; url: string; ok: boolean; detail: string }>
}

export interface SwitchResult {
  ok: boolean
  blocked?: string
  mode: TunnelMode
  urls: TunnelUrls
  webhookChanged: boolean
  verify: VerifyResult
}

export interface TunnelDeps {
  getConfig(): SentinelConfig
  /** Persist a patch to local config + reload; return reloaded config. */
  updateConfig(patch: Record<string, unknown>): SentinelConfig
  /** Beacon retargets + Guardian public URL refresh. */
  onTargetsChanged(config: SentinelConfig): void
  audit(entry: { subsystem: 'tunnel'; action: string; outcome: 'success' | 'failed' | 'info'; message: string }): void
}

const WEBHOOK_PATH = '/webhook/whatsapp'

/** Resolve the externally-visible URLs for a given mode. */
export function urlsForMode(config: SentinelConfig, mode: TunnelMode): TunnelUrls {
  const t = config.tunnel
  if (mode === 'none') {
    return { appUrl: '', apiUrl: '', devtoolsUrl: 'http://127.0.0.1:4000', webhookUrl: '' }
  }
  if (mode === 'ngrok') {
    const base = t.ngrok.appUrl
    return { appUrl: base, apiUrl: base, devtoolsUrl: base, webhookUrl: base ? `${base}${WEBHOOK_PATH}` : '' }
  }
  if (mode === 'cloudflare') {
    return { appUrl: t.cloudflare.appUrl, apiUrl: t.cloudflare.apiUrl, devtoolsUrl: t.cloudflare.devtoolsUrl, webhookUrl: t.cloudflare.apiUrl ? `${t.cloudflare.apiUrl}${WEBHOOK_PATH}` : '' }
  }
  return { appUrl: t.permanent.appUrl, apiUrl: t.permanent.apiUrl, devtoolsUrl: t.permanent.devtoolsUrl, webhookUrl: t.permanent.apiUrl ? `${t.permanent.apiUrl}${WEBHOOK_PATH}` : '' }
}

export function activeUrls(config: SentinelConfig): TunnelUrls {
  return urlsForMode(config, config.tunnel.activeMode)
}

/** Full health check across app + API + DevTools URLs. `none` is always healthy. */
export async function verifyMode(config: SentinelConfig, mode: TunnelMode): Promise<VerifyResult> {
  if (mode === 'none') return { ok: true, checks: [] }
  const urls = urlsForMode(config, mode)
  const checks: VerifyResult['checks'] = []
  const probe = async (label: string, url: string) => {
    if (!url) {
      checks.push({ label, url, ok: false, detail: 'URL not set' })
      return
    }
    const r = await httpProbe(url, { expectStatuses: [200] })
    checks.push({ label, url, ok: r.ok, detail: r.ok ? `200 ${r.responseTimeMs}ms` : r.error ?? `status ${r.status}` })
  }
  await probe('App URL', `${urls.appUrl}/health`)
  await probe('API URL', `${urls.apiUrl}/health`)
  await probe('DevTools URL', `${urls.devtoolsUrl}/api/health`)
  return { ok: checks.every((c) => c.ok), checks }
}

/** Switch (and verify, unless `none`) the active tunnel mode. */
export async function switchMode(deps: TunnelDeps, mode: TunnelMode, opts: { skipVerify?: boolean } = {}): Promise<SwitchResult> {
  const config = deps.getConfig()
  const previousMode = config.tunnel.activeMode
  const previousUrls = activeUrls(config)
  const urls = urlsForMode(config, mode)

  const verify = opts.skipVerify || mode === 'none' ? { ok: true, checks: [] } : await verifyMode(config, mode)
  if (!verify.ok) {
    deps.audit({ subsystem: 'tunnel', action: 'switch.blocked', outcome: 'failed', message: `Verification failed switching to ${mode}` })
    return { ok: false, blocked: 'Health check failed — see checks.', mode, urls, webhookChanged: false, verify }
  }

  const webhookChanged = previousUrls.apiUrl !== urls.apiUrl
  const now = new Date().toISOString()
  const next = deps.updateConfig({
    tunnel: {
      activeMode: mode,
      previousMode,
      lastSwitched: now,
      lastVerified: mode === 'none' ? config.tunnel.lastVerified : now,
      webhookReminderPending: webhookChanged ? true : config.tunnel.webhookReminderPending
    },
    targets: {
      docmeeApiHealthUrl: urls.apiUrl ? `${urls.apiUrl}/health` : '',
      cloudflareTunnelHealthUrl: mode === 'cloudflare' ? `${urls.appUrl}/health` : config.targets.cloudflareTunnelHealthUrl
    }
  })

  writeEnvTools(mode, urls, now)
  deps.onTargetsChanged(next)
  deps.audit({ subsystem: 'tunnel', action: 'switch', outcome: 'success', message: `Switched ${previousMode} → ${mode}` })
  return { ok: true, mode, urls, webhookChanged, verify }
}

export async function rollback(deps: TunnelDeps): Promise<SwitchResult> {
  const prev = deps.getConfig().tunnel.previousMode ?? 'none'
  return switchMode(deps, prev)
}

/** Write derived TUNNEL_* vars so other tools never parse the JSON config. */
export function writeEnvTools(mode: TunnelMode, urls: TunnelUrls, verifiedAt: string) {
  const vars: Record<string, string> = {
    TUNNEL_MODE: mode,
    TUNNEL_APP_URL: urls.appUrl,
    TUNNEL_API_URL: urls.apiUrl,
    TUNNEL_DEVTOOLS_URL: urls.devtoolsUrl,
    TUNNEL_WEBHOOK_URL: urls.webhookUrl,
    TUNNEL_VERIFIED_AT: verifiedAt
  }
  let lines: string[] = []
  if (fs.existsSync(envToolsFile)) {
    lines = fs.readFileSync(envToolsFile, 'utf8').split(/\r?\n/).filter((l) => !/^TUNNEL_[A-Z_]+=/.test(l) && l.trim() !== '# Written by Sentinel on tunnel switch — do not edit manually')
  }
  // Drop a trailing blank line if present to keep formatting tidy.
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  lines.push('# Written by Sentinel on tunnel switch — do not edit manually')
  for (const [k, v] of Object.entries(vars)) lines.push(`${k}=${v}`)
  fs.writeFileSync(envToolsFile, `${lines.join('\n')}\n`)
}

export function dismissWebhookReminder(deps: TunnelDeps) {
  deps.updateConfig({ tunnel: { webhookReminderPending: false } })
}
