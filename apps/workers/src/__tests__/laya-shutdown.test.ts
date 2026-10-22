import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('worker LAYA shutdown lifecycle', () => {
  let signals: Map<string, () => void>
  let drain: () => void
  let closeWorkers: ReturnType<typeof vi.fn>
  let closeLaya: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    signals = new Map()
    const pending = new Promise<void>(resolve => { drain = resolve })
    closeWorkers = vi.fn(() => pending)
    closeLaya = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(process, 'on').mockImplementation(((signal: string, listener: () => void) => {
      signals.set(signal, listener)
      return process
    }) as typeof process.on)
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.doMock('dotenv/config', () => ({}))
    vi.doMock('@docmee/config', () => ({ RATE_LIMITS: {} }))
    vi.doMock('@docmee/shared', () => ({ releaseBuildId: () => 'test' }))
    vi.doMock('@docmee/queue', () => ({
      createWorker: () => ({ close: closeWorkers }),
      licenseHeartbeatQueue: {}, reportsQueue: {}, sheetsSyncQueue: {}, reviewRequestQueue: {},
    }))
    vi.doMock('@docmee/db', () => ({ createServiceDbClient: () => { throw new Error('unexpected database use') } }))
    const processors = [
      ['conversation-processor', 'processConversationJob'], ['delivery-status', 'processDeliveryStatusJob'],
      ['transcription-processor', 'processTranscriptionJob'], ['agent-processor', 'processAgentJob'],
      ['scheduling-processor', 'processSchedulingJob'], ['notification-processor', 'processNotificationJob'],
      ['license-heartbeat', 'processLicenseHeartbeatJob'], ['kb-embed', 'processKbEmbedJob'],
      ['follow-up', 'processFollowUpJob'], ['reports', 'processReportsJob'],
      ['sheets-sync', 'processSheetsSyncJob'], ['review-request', 'processReviewRequestJob'],
      ['workflow-runner', 'processWorkflowRunJob'],
    ]
    for (const [file, exported] of processors) {
      vi.doMock(`../${file}.worker.js`, () => ({ [exported!]: vi.fn() }))
    }
    vi.doMock('../timeout-monitor.js', () => ({ runTimeoutChecks: vi.fn() }))
    vi.doMock('../reports.scheduler.js', () => ({ bootstrapReportsScheduler: vi.fn().mockResolvedValue(undefined) }))
    vi.doMock('../calendar-sync-retry.js', () => ({ runCalendarSyncRetry: vi.fn() }))
    vi.doMock('../media-cleanup.js', () => ({ startMediaCleanupScheduler: () => setInterval(() => {}, 10_000) }))
    vi.doMock('../sensitive-data-cleanup.js', () => ({ startSensitiveDataCleanupScheduler: () => setInterval(() => {}, 10_000) }))
    vi.doMock('../scheduled-messages.scheduler.js', () => ({ startScheduledMessagesRuntime: () => null }))
    vi.doMock('../laya.js', () => ({ closeLaya }))
  })

  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('closes LAYA only after all jobs drain, once even if both signals arrive', async () => {
    await import('../index.js')
    signals.get('SIGTERM')!()
    signals.get('SIGINT')!()
    expect(closeWorkers).toHaveBeenCalledTimes(15)
    expect(closeLaya).not.toHaveBeenCalled()
    expect(process.exit).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
    drain()
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0))
    expect(closeLaya).toHaveBeenCalledTimes(1)
  })

  it('finishes shutdown with a redacted warning if LAYA pool closure fails', async () => {
    closeLaya.mockRejectedValue(new Error('sensitive connection details'))
    await import('../index.js')
    signals.get('SIGINT')!()
    drain()
    await vi.waitFor(() => expect(process.exit).toHaveBeenCalledWith(0))
    expect(console.error).toHaveBeenCalledWith('[workers] LAYA controls connection close failed')
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive connection details')
  })
})
