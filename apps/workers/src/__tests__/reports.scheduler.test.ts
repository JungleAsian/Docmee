import { describe, expect, it, vi } from 'vitest'
import { bootstrapReportsScheduler, enqueueReportsCatchup } from '../reports.scheduler.js'

describe('durable reports scheduler', () => {
  it('upserts one durable hourly scheduler and a stable startup catch-up job', async () => {
    const queue = { upsertJobScheduler: vi.fn(), add: vi.fn() }
    await bootstrapReportsScheduler(queue as never, new Date('2026-07-20T08:22:00.000Z'))
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith('reports-hourly-v1', { every: 3_600_000 }, { name: 'tick', data: { source: 'durable-scheduler' } })
    expect(queue.add).toHaveBeenCalledWith('tick', { source: 'startup-catchup', evaluatedAt: '2026-07-20T08:22:00.000Z' }, { jobId: 'reports-catchup:2026-07-20T08' })
  })

  it('uses one catch-up id for every replica started in one hour', async () => {
    const queue = { upsertJobScheduler: vi.fn(), add: vi.fn() }
    await enqueueReportsCatchup(queue as never, new Date('2026-07-20T08:01:00.000Z'))
    await enqueueReportsCatchup(queue as never, new Date('2026-07-20T08:59:00.000Z'))
    expect(queue.add.mock.calls[0]![2]).toEqual(queue.add.mock.calls[1]![2])
  })
})
