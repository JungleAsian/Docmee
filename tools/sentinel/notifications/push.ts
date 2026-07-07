import { logFileFor } from '../lib/paths.js'
import { readJsonFile, writeJsonFile } from '../lib/json-store.js'
import type { SentinelConfig } from '../config/schema.js'
import type { SentinelSeverity } from '../lib/issues.js'

export interface PushEvent {
  ts: string
  severity: SentinelSeverity
  title: string
  message: string
}

const PUSH_QUEUE = logFileFor('sentinel-push-queue.json')
const SEVERITY_RANK: Record<SentinelSeverity, number> = { info: 0, warning: 1, critical: 2 }

/**
 * PWA push. Web Push delivery (VAPID + subscriptions) is owned by the DevTools
 * PWA layer; Sentinel records push intents to a queue the PWA service drains, so
 * the daemon stays dependency-free. Honours the configured minimum severity.
 */
export class PushNotifier {
  private getConfig: () => SentinelConfig

  constructor(getConfig: () => SentinelConfig) {
    this.getConfig = getConfig
  }

  send(severity: SentinelSeverity, title: string, message: string) {
    const cfg = this.getConfig().notifications.push
    if (!cfg.enabled) return
    if (SEVERITY_RANK[severity] < SEVERITY_RANK[cfg.minSeverity]) return
    const queue = readJsonFile<PushEvent[]>(PUSH_QUEUE, [])
    queue.unshift({ ts: new Date().toISOString(), severity, title, message })
    writeJsonFile(PUSH_QUEUE, queue.slice(0, 200))
  }

  pending(): PushEvent[] {
    return readJsonFile<PushEvent[]>(PUSH_QUEUE, [])
  }
}
