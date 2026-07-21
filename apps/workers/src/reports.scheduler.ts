const HOUR_MS = 60 * 60 * 1000
const SCHEDULER_ID = 'reports-hourly-v1'
export interface ReportsSchedulerQueue {
  upsertJobScheduler(id: string, options: { every: number }, template: { name: string; data: Record<string, string> }): Promise<unknown>
  add(name: string, data: Record<string, string>, options: { jobId: string }): Promise<unknown>
}

/** Every replica upserts this single Redis-backed scheduler; none owns an interval. */
export async function ensureReportsScheduler(queue: ReportsSchedulerQueue): Promise<void> {
  await queue.upsertJobScheduler(SCHEDULER_ID, { every: HOUR_MS }, {
    name: 'tick', data: { source: 'durable-scheduler' },
  })
}

/** A restart evaluates the currently due clinic-local periods exactly once per UTC hour. */
export async function enqueueReportsCatchup(queue: ReportsSchedulerQueue, now = new Date()): Promise<void> {
  const hourBucket = now.toISOString().slice(0, 13)
  await queue.add('tick', { source: 'startup-catchup', evaluatedAt: now.toISOString() }, {
    // BullMQ reserves ':' in custom job IDs. Keep the hourly bucket in the
    // idempotency key without using its ISO timestamp separator.
    jobId: `reports-catchup-${hourBucket}`,
  })
}

export async function bootstrapReportsScheduler(queue: ReportsSchedulerQueue, now = new Date()): Promise<void> {
  await ensureReportsScheduler(queue)
  await enqueueReportsCatchup(queue, now)
}
