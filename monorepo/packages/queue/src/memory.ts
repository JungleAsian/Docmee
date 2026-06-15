import type {
  AddOptions,
  Closable,
  JobHandler,
  Producer,
  QueueName,
  QueueProvider,
} from "./types.js";

/**
 * In-memory queue (tests/dev + no-Redis fallback). Jobs added before a worker
 * exists are buffered and drained when the worker registers. A handler that throws
 * routes the job to the dead-letter queue (mirrors BullMQ's failure path), so DLQ
 * behavior is testable without Redis. No real retry/backoff (that's BullMQ's job).
 */
export class InMemoryQueueProvider implements QueueProvider {
  private readonly handlers = new Map<QueueName, JobHandler<unknown>>();
  private readonly buffers = new Map<QueueName, unknown[]>();

  queue<T = unknown>(name: QueueName): Producer<T> {
    return {
      name,
      add: async (data: T, _opts?: AddOptions) => {
        await this.dispatch(name, data);
      },
    };
  }

  worker<T = unknown>(name: QueueName, handler: JobHandler<T>): Closable {
    this.handlers.set(name, handler as JobHandler<unknown>);
    // Drain anything buffered before this worker existed.
    const buffered = this.buffers.get(name) ?? [];
    this.buffers.delete(name);
    void Promise.all(buffered.map((d) => this.dispatch(name, d)));
    return {
      close: async () => {
        this.handlers.delete(name);
      },
    };
  }

  private async dispatch(name: QueueName, data: unknown): Promise<void> {
    const handler = this.handlers.get(name);
    if (!handler) {
      const buf = this.buffers.get(name) ?? [];
      buf.push(data);
      this.buffers.set(name, buf);
      return;
    }
    try {
      await handler(data);
    } catch (err) {
      if (name !== "dead-letter") {
        await this.dispatch("dead-letter", {
          queue: name,
          data,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  async close(): Promise<void> {
    this.handlers.clear();
    this.buffers.clear();
  }
}
