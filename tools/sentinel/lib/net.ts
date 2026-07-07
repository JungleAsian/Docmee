import http from 'node:http'
import https from 'node:https'
import net from 'node:net'

const MAX_BODY_BYTES = 4 * 1024 // Layer 5 — response body size limit (Guardian spec)
const DEFAULT_TIMEOUT_MS = 5000

export interface HttpProbeResult {
  ok: boolean
  status: number | null
  responseTimeMs: number
  error?: string
  // Body is intentionally truncated and never used to drive recovery logic.
  bodySnippet?: string
}

/**
 * Outbound-only HTTP probe with a hard timeout and a 4KB body cap. Returns a
 * sanitised result — status code + boolean only — never the verbatim body in logs.
 */
export function httpProbe(url: string, opts: { timeoutMs?: number; expectStatuses?: number[]; method?: string } = {}): Promise<HttpProbeResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const start = Date.now()
  return new Promise((resolve) => {
    let settled = false
    const finish = (r: HttpProbeResult) => {
      if (settled) return
      settled = true
      resolve(r)
    }
    let lib: typeof http | typeof https
    let parsed: URL
    try {
      parsed = new URL(url)
      lib = parsed.protocol === 'https:' ? https : http
    } catch {
      finish({ ok: false, status: null, responseTimeMs: 0, error: 'invalid-url' })
      return
    }
    const req = lib.request(parsed, { method: opts.method ?? 'GET', timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total <= MAX_BODY_BYTES) chunks.push(chunk)
        if (total > MAX_BODY_BYTES) res.destroy()
      })
      res.on('end', () => {
        const status = res.statusCode ?? null
        const expect = opts.expectStatuses ?? [200]
        finish({
          ok: status !== null && expect.includes(status),
          status,
          responseTimeMs: Date.now() - start,
          bodySnippet: Buffer.concat(chunks).toString('utf8').slice(0, 200)
        })
      })
    })
    req.on('timeout', () => {
      req.destroy()
      finish({ ok: false, status: null, responseTimeMs: Date.now() - start, error: `timeout after ${timeoutMs}ms` })
    })
    req.on('error', (err) => {
      finish({ ok: false, status: null, responseTimeMs: Date.now() - start, error: sanitiseError(err.message) })
    })
    req.end()
  })
}

/** TCP reachability check (e.g. VPS SSH port 22). */
export function tcpProbe(host: string, port: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HttpProbeResult> {
  const start = Date.now()
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false
    const finish = (r: HttpProbeResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(r)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish({ ok: true, status: null, responseTimeMs: Date.now() - start }))
    socket.once('timeout', () => finish({ ok: false, status: null, responseTimeMs: Date.now() - start, error: 'tcp-timeout' }))
    socket.once('error', (err) => finish({ ok: false, status: null, responseTimeMs: Date.now() - start, error: sanitiseError(err.message) }))
    socket.connect(port, host)
  })
}

/** Strip anything that could leak a credential or connection string from an error. */
export function sanitiseError(message: string) {
  return message
    .replace(/\/\/[^@\s]+@/g, '//***@') // user:pass@host
    .replace(/(token|key|secret|password)=[^&\s]+/gi, '$1=***')
    .slice(0, 200)
}
