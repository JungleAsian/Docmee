import http from 'node:http'
import { logEvent } from '../lib/logger.js'
import type { SentinelConfig } from '../config/schema.js'
import type { SentinelIssue } from '../lib/issues.js'
import type { BeaconTargetStatus } from '../beacon/index.js'
import type { ProviderCard, SwitchResult } from '../cortex/index.js'
import type { ProviderId } from '../config/schema.js'

export interface DaemonStatusView {
  status: string
  uptimeSeconds: number
  version: string
  subsystems: Array<{ name: string; status: string; detail?: string }>
  tray: string
  provider: string
  issues: { active: number; critical: number; warning: number; approval: number }
}

/** Everything the API needs from the daemon. Keeps the HTTP layer decoupled. */
export interface ApiContext {
  version: string
  startedAt: number
  getConfig(): SentinelConfig
  redactedConfig(): SentinelConfig
  updateConfig(patch: Record<string, unknown>): { ok: boolean; errors: string[] }
  listIssues(filter: { source?: string; status?: string; severity?: string }): SentinelIssue[]
  getIssue(id: string): SentinelIssue | null
  approveIssue(id: string): { ok: boolean; message: string }
  dismissIssue(id: string): { ok: boolean; message: string }
  assignIssue(id: string, agent?: string, provider?: string): { ok: boolean; message: string }
  beaconStatuses(): BeaconTargetStatus[]
  taskLog(issueId: string, lines: number): string[]
  daemonStatus(): DaemonStatusView
  cortexStatus(): { globalDefault: string; overrides: Record<string, string>; agents: unknown[] }
  cortexCards(): Promise<ProviderCard[]>
  cortexSwitch(provider: ProviderId, force: boolean): Promise<SwitchResult>
  cortexSession(): { pct: number | null; paused: boolean; resumeAt: string | null }
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  res.end(json)
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (c: Buffer) => {
      total += c.length
      if (total <= 256 * 1024) chunks.push(c)
    })
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null) // signals bad JSON
      }
    })
    req.on('error', () => resolve(null))
  })
}

export class SentinelApi {
  private ctx: ApiContext
  private server: http.Server | null = null

  constructor(ctx: ApiContext) {
    this.ctx = ctx
  }

  start(): Promise<void> {
    const port = this.ctx.getConfig().api.port
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => void this.handle(req, res))
      this.server.on('error', (err) => reject(err))
      this.server.listen(port, '127.0.0.1', () => {
        logEvent('api', 'info', 'api.listen', `Sentinel API listening on 127.0.0.1:${port}`)
        resolve()
      })
    })
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve()
      this.server.close(() => resolve())
    })
  }

  private authorized(req: http.IncomingMessage): boolean {
    const token = this.ctx.getConfig().api.token
    if (!token) return false
    const header = req.headers['authorization'] ?? ''
    return header === `Bearer ${token}`
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean)
    const method = req.method ?? 'GET'

    // --- Open: health (no auth — Beacon polls this) ---
    if (url.pathname === '/health') {
      return send(res, 200, { status: 'ok', uptime: Math.round((Date.now() - this.ctx.startedAt) / 1000), version: this.ctx.version })
    }

    // --- Everything else requires a valid bearer token ---
    if (!this.authorized(req)) {
      return send(res, 401, { error: 'unauthorized' })
    }

    try {
      // /api/status
      if (method === 'GET' && url.pathname === '/api/status') return send(res, 200, this.ctx.daemonStatus())
      // /api/beacon
      if (method === 'GET' && url.pathname === '/api/beacon') return send(res, 200, { targets: this.ctx.beaconStatuses() })
      // /api/config
      if (method === 'GET' && url.pathname === '/api/config') return send(res, 200, this.ctx.redactedConfig())
      if (method === 'POST' && url.pathname === '/api/config') {
        const body = await readBody(req)
        if (body === null || typeof body !== 'object') return send(res, 400, { error: 'invalid-json' })
        const result = this.ctx.updateConfig(body as Record<string, unknown>)
        return send(res, result.ok ? 200 : 400, result)
      }
      // /api/issues
      if (method === 'GET' && url.pathname === '/api/issues') {
        const issues = this.ctx.listIssues({
          source: url.searchParams.get('source') ?? undefined,
          status: url.searchParams.get('status') ?? undefined,
          severity: url.searchParams.get('severity') ?? undefined
        })
        return send(res, 200, { issues })
      }
      // /api/issues/:id and sub-actions
      if (parts[0] === 'api' && parts[1] === 'issues' && parts[2]) {
        const id = decodeURIComponent(parts[2])
        const action = parts[3]
        if (method === 'GET' && !action) {
          const issue = this.ctx.getIssue(id)
          return issue ? send(res, 200, issue) : send(res, 404, { error: 'not-found' })
        }
        if (method === 'POST' && action === 'approve') return send(res, 200, this.ctx.approveIssue(id))
        if (method === 'POST' && action === 'dismiss') return send(res, 200, this.ctx.dismissIssue(id))
        if (method === 'POST' && action === 'assign') {
          const body = (await readBody(req)) as { agent?: string; provider?: string } | null
          if (body === null) return send(res, 400, { error: 'invalid-json' })
          return send(res, 200, this.ctx.assignIssue(id, body.agent, body.provider))
        }
      }
      // /api/cortex
      if (method === 'GET' && url.pathname === '/api/cortex') {
        const cards = await this.ctx.cortexCards()
        return send(res, 200, { ...this.ctx.cortexStatus(), cards })
      }
      if (method === 'GET' && url.pathname === '/api/cortex/session') return send(res, 200, this.ctx.cortexSession())
      if (method === 'POST' && url.pathname === '/api/cortex/switch') {
        const body = (await readBody(req)) as { provider?: ProviderId; force?: boolean } | null
        if (body === null || !body.provider) return send(res, 400, { error: 'provider required' })
        const result = await this.ctx.cortexSwitch(body.provider, Boolean(body.force))
        return send(res, result.ok ? 200 : 409, result)
      }
      // /api/tasks/:issueId/log
      if (method === 'GET' && parts[0] === 'api' && parts[1] === 'tasks' && parts[2] && parts[3] === 'log') {
        const lines = Number(url.searchParams.get('lines') ?? '200')
        return send(res, 200, { log: this.ctx.taskLog(decodeURIComponent(parts[2]), Number.isFinite(lines) ? lines : 200) })
      }

      return send(res, 404, { error: 'not-found' })
    } catch (err) {
      logEvent('api', 'error', 'api.error', `Request failed: ${(err as Error).message}`)
      return send(res, 500, { error: 'internal' })
    }
  }
}
