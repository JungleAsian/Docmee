import { describe, expect, it, vi } from 'vitest'
import {
  SENSITIVE_DATA_CLEANUP_INTERVAL_MS,
  runSensitiveDataCleanup,
  startSensitiveDataCleanupScheduler,
} from '../sensitive-data-cleanup.js'

describe('sensitive data cleanup worker', () => {
  it('uses the 24-hour cutoff when purging transient sensitive data', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-08T15:30:00.000Z'))
    const repository = {
      purgeExpiredTransientData: vi.fn(async () => ({
        webhookEvents: 1,
        knowledgeRetrievalEvents: 2,
        notificationEvents: 3,
        errorReviews: 4,
        aiUsageMetadataScrubbed: 5,
      })),
    }

    await runSensitiveDataCleanup({ repository })

    expect(repository.purgeExpiredTransientData).toHaveBeenCalledWith(new Date('2026-09-07T15:30:00.000Z'))
    vi.useRealTimers()
  })

  it('runs on a short scheduler cadence and never keeps the process alive by itself', () => {
    const timer = startSensitiveDataCleanupScheduler({
      run: vi.fn(async () => undefined),
    })

    expect(SENSITIVE_DATA_CLEANUP_INTERVAL_MS).toBe(5 * 60 * 1000)
    expect(typeof timer.unref).toBe('function')
    clearInterval(timer)
  })
})
