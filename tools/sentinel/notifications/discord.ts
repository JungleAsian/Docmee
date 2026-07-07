import https from 'node:https'
import http from 'node:http'
import { logEvent } from '../lib/logger.js'
import type { SentinelConfig } from '../config/schema.js'
import type { SentinelSeverity } from '../lib/issues.js'

/** POST a Discord webhook payload. Outbound-only, sanitised, never throws. */
export function postWebhook(url: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(false)
      return
    }
    let parsed: URL
    let lib: typeof http | typeof https
    try {
      parsed = new URL(url)
      lib = parsed.protocol === 'https:' ? https : http
    } catch {
      resolve(false)
      return
    }
    const body = JSON.stringify({ content: content.slice(0, 1900) })
    const req = lib.request(
      parsed,
      { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }, timeout: 5000 },
      (res) => {
        res.resume()
        resolve((res.statusCode ?? 500) < 300)
      }
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.write(body)
    req.end()
  })
}

export class Notifier {
  private getConfig: () => SentinelConfig

  constructor(getConfig: () => SentinelConfig) {
    this.getConfig = getConfig
  }

  private quietNow() {
    const q = this.getConfig().notifications.quietHours
    if (!q.enabled) return false
    const hour = new Date().getHours()
    return q.startHour <= q.endHour ? hour >= q.startHour && hour < q.endHour : hour >= q.startHour || hour < q.endHour
  }

  /** Critical/alert notifications always fire — quiet hours never suppress them. */
  async alert(severity: SentinelSeverity, title: string, message: string) {
    const n = this.getConfig().notifications
    const icon = severity === 'critical' ? '🚨' : severity === 'warning' ? '⚠️' : 'ℹ️'
    const content = `${icon} Sentinel — ${title}\n${message}`
    const ok = await postWebhook(n.alertsWebhookUrl, content)
    if (severity === 'critical' && n.crossPostCriticalToDevtools && n.devtoolsCriticalWebhookUrl) {
      await postWebhook(n.devtoolsCriticalWebhookUrl, content)
    }
    logEvent('api', severity === 'critical' ? 'critical' : 'warn', 'discord.alert', `${title}`, { delivered: ok })
  }

  /** Activity notifications are suppressed during quiet hours. */
  async activity(title: string, message: string) {
    if (this.quietNow()) return
    const n = this.getConfig().notifications
    const ok = await postWebhook(n.activityWebhookUrl, `✅ Sentinel — ${title}\n${message}`)
    logEvent('api', 'info', 'discord.activity', `${title}`, { delivered: ok })
  }
}
