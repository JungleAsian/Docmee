import { describe, it, expect, vi, afterEach } from 'vitest'
const h = vi.hoisted(() => ({ add: vi.fn(), createWorker: vi.fn(), reconcile: vi.fn(), end: vi.fn(), db: vi.fn() }))
vi.mock('@docmee/db', () => ({ createServiceDbClient: h.db, createScheduledMessagesRepository: () => ({ reconcile: h.reconcile }) }))
vi.mock('@docmee/queue', () => ({ createWorker: h.createWorker, scheduledMessagesQueue: { add: h.add } }))
vi.mock('../scheduled-messages.worker.js', () => ({ processScheduledMessageJob: vi.fn() }))
import { reconcileScheduledMessages, startScheduledMessagesRuntime } from '../scheduled-messages.scheduler.js'
const original = process.env['SCHEDULED_MESSAGES_WORKER_ENABLED']
afterEach(() => { vi.clearAllMocks(); if (original === undefined) delete process.env['SCHEDULED_MESSAGES_WORKER_ENABLED']; else process.env['SCHEDULED_MESSAGES_WORKER_ENABLED'] = original })
describe('scheduled message runtime', () => {
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
