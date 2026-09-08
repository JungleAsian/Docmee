import {
  createSensitiveRetentionRepository,
  createServiceDbClient,
  type SensitiveRetentionRepository,
} from '@docmee/db'
import { sensitiveTransientCutoff } from '@docmee/shared'

export const SENSITIVE_DATA_CLEANUP_INTERVAL_MS = 5 * 60 * 1000

interface CleanupOptions {
  repository?: Pick<SensitiveRetentionRepository, 'purgeExpiredTransientData'>
  now?: Date
}

export async function runSensitiveDataCleanup(options: CleanupOptions = {}): Promise<void> {
  const cutoff = sensitiveTransientCutoff(options.now ?? new Date())

  if (options.repository) {
    await options.repository.purgeExpiredTransientData(cutoff)
    return
  }

  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    const repository = createSensitiveRetentionRepository(sql)
    const result = await repository.purgeExpiredTransientData(cutoff)
    const total =
      result.webhookEvents +
      result.knowledgeRetrievalEvents +
      result.notificationEvents +
      result.errorReviews +
      result.aiUsageMetadataScrubbed
    if (total > 0) {
      console.info(
        `[sensitive-data-cleanup] purged/scrubbed ${total} expired sensitive transient row(s) older than ${cutoff.toISOString()}`,
      )
    }
  } finally {
    await sql.end()
  }
}

export function startSensitiveDataCleanupScheduler(options: {
  run?: () => Promise<void>
} = {}): NodeJS.Timeout {
  const run = options.run ?? runSensitiveDataCleanup
  const timer = setInterval(() => {
    void run().catch((error) => {
      console.error('[sensitive-data-cleanup] tick failed:', error instanceof Error ? error.message : error)
    })
  }, SENSITIVE_DATA_CLEANUP_INTERVAL_MS)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}
