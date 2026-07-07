// Only file permitted to import bullmq
import { Queue, Worker, QueueEvents } from 'bullmq'
import { Redis } from 'ioredis'

// Re-export bullmq types so consumers never import bullmq directly (no-direct-bullmq rule)
// and so inferred return types stay portable across the monorepo.
export type { Job, Processor, Queue, Worker, QueueEvents } from 'bullmq'

export function createRedisConnection(): Redis {
  const url = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
  return new Redis(url, { maxRetriesPerRequest: null })
}

export function createQueue(name: string): Queue {
  return new Queue(name, {
    connection: createRedisConnection(),
    // CRE-54: retry transient failures with exponential backoff, and bound history
    // (prune completed aggressively, keep failed a week for triage) so Redis does
    // not grow unbounded and failed jobs stay inspectable.
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  })
}

export function createWorker(
  name: string,
  processor: ConstructorParameters<typeof Worker>[1],
  concurrency = 10,
): Worker {
  return new Worker(name, processor, { connection: createRedisConnection(), concurrency })
}

export function createQueueEvents(name: string): QueueEvents {
  return new QueueEvents(name, { connection: createRedisConnection() })
}
