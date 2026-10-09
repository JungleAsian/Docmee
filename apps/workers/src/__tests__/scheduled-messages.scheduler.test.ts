import { describe, it, expect, vi, afterEach } from 'vitest'
const h = vi.hoisted(() => ({ add: vi.fn(), createWorker: vi.fn(), reconcile: vi.fn(), end: vi.fn(), db: vi.fn() }))
vi.mock('@docmee/db', () => ({ createServiceDbClient: h.db, createScheduledMessagesRepository: () => ({ reconcile: h.reconcile }) }))
vi.mock('@docmee/queue', () => ({ createWorker: h.createWorker, scheduledMessagesQueue: { add: h.add } }))
vi.mock('../scheduled-messages.worker.js', () => ({ processScheduledMessageJob: vi.fn() }))
import { reconcileScheduledMessages, startScheduledMessagesRuntime } from '../scheduled-messages.scheduler.js'
const original = process.env['SCHEDULED_MESSAGES_WORKER_ENABLED']
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); vi.restoreAllMocks(); if (original === undefined) delete process.env['SCHEDULED_MESSAGES_WORKER_ENABLED']; else process.env['SCHEDULED_MESSAGES_WORKER_ENABLED'] = original })
describe('scheduled message runtime', () => {
  it('recovers a failed queue wakeup on the next reconciliation without changing durable rows', async () => {
    h.db.mockReturnValue({ end: h.end })
    h.reconcile.mockResolvedValue([{ id: 'synthetic-id', clinicId: 'clinic', version: 2 }])
    h.add.mockRejectedValueOnce(new Error('synthetic Redis outage')).mockResolvedValue(undefined)
    await expect(reconcileScheduledMessages()).rejects.toThrow('synthetic Redis outage')
    await reconcileScheduledMessages()
    expect(h.reconcile).toHaveBeenCalledTimes(2)
    expect(h.add).toHaveBeenCalledTimes(2)
    expect(h.add.mock.calls[0]).toEqual(h.add.mock.calls[1])
    expect(h.end).toHaveBeenCalledTimes(2)
  })
  it('closes the database connection when durable reconciliation fails', async () => {
    h.db.mockReturnValue({ end: h.end })
    h.reconcile.mockRejectedValue(new Error('synthetic DB outage'))
    await expect(reconcileScheduledMessages()).rejects.toThrow('synthetic DB outage')
    expect(h.add).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalledTimes(1)
  })
  it('never overlaps reconciliation ticks and resumes after a failed tick', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env['SCHEDULED_MESSAGES_WORKER_ENABLED'] = 'true'
    h.db.mockReturnValue({ end: h.end })
    let rejectFirst!: (reason: Error) => void
    h.reconcile.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject })).mockResolvedValue([])
    const runtime = startScheduledMessagesRuntime()!
    try {
      await vi.advanceTimersByTimeAsync(120_000)
      expect(h.reconcile).toHaveBeenCalledTimes(1)
      rejectFirst(new Error('synthetic failed tick'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(h.reconcile).toHaveBeenCalledTimes(2)
      expect(log).toHaveBeenCalledWith('[scheduled-messages] reconciliation failed; durable rows retained')
      expect(h.createWorker).toHaveBeenCalledTimes(1)
    } finally { clearInterval(runtime.timer) }
  })
  it('is absent unless the worker is explicitly opted in', () => {
    delete process.env['SCHEDULED_MESSAGES_WORKER_ENABLED']
    expect(startScheduledMessagesRuntime()).toBe(null)
    expect(h.createWorker).not.toHaveBeenCalled()
    expect(h.db).not.toHaveBeenCalled()
  })
  it('rebuilds queue wakeups from durable due rows and clears failed transport wakeups for safe DB reconciliation', async () => {
    h.db.mockReturnValue({ end: h.end })
    h.reconcile.mockResolvedValue([{ id: 'synthetic-id', clinicId: 'clinic', version: 2 }])
    await reconcileScheduledMessages()
    expect(h.add).toHaveBeenCalledWith('deliver', { clinicId: 'clinic', messageId: 'synthetic-id', version: 2 }, { jobId: 'scheduled-synthetic-id-v2', attempts: 1, removeOnComplete: true, removeOnFail: true })
    expect(h.end).toHaveBeenCalled()
  })
})
