import { Queue, Worker, type ConnectionOptions } from "bullmq";
import { Redis } from "ioredis";
import type { Closable, JobHandler, Producer, QueueName, QueueProvider } from "./types.js";

/**
 * BullMQ-backed provider (production, Redis). Jobs retry with exponential backoff;
 * once attempts are exhausted the job is routed to the dead-letter queue so nothing
 * is silently dropped. Verified against the live Redis on the VPS.
 */
const ATTEMPTS = 3;

export class BullMqQueueProvider implements QueueProvider {
  private readonly redis: Redis;
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];

  constructor(redisUrl: string) {
    // BullMQ requires maxRetriesPerRequest: null on the connection.
    this.redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  }

  // BullMQ accepts an IORedis instance at runtime; the type wants ConnectionOptions.
  private get connection(): ConnectionOptions {
    return this.redis as unknown as ConnectionOptions;
  }

  private rawQueue(name: QueueName): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, { connection: this.connection });
      this.queues.set(name, q);
    }
    return q;
  }

  queue<T = unknown>(name: QueueName): Producer<T> {
    const q = this.rawQueue(name);
    return {
      name,
      add: async (data: T, opts) => {
        await q.add(name, data, {
          attempts: name === "dead-letter" ? 1 : ATTEMPTS,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: true,
          removeOnFail: 1000,
          delay: opts?.delayMs,
        });
      },
    };
  }

  worker<T = unknown>(name: QueueName, handler: JobHandler<T>): Closable {
    const w = new Worker<T>(
      name,
      async (job) => {
        await handler(job.data);
      },
      { connection: this.connection },
    );
    w.on("failed", (job, err) => {
      if (name === "dead-letter" || !job) return;
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? ATTEMPTS);
      if (exhausted) {
        void this.queue("dead-letter").add({
          queue: name,
          data: job.data,
          error: err?.message,
        });
      }
    });
    this.workers.push(w);
    return { close: () => w.close() };
  }

  async close(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    await this.redis.quit();
  }
}
