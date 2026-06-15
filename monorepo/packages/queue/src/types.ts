/**
 * Domain-agnostic queue abstraction (architecture §12). Six queues; a Producer
 * enqueues, a Worker consumes. Two implementations: BullMQ (Redis) for production,
 * and an in-memory fake for tests/dev (and the no-Redis fallback).
 */
export const QUEUE_NAMES = [
  "inbound",
  "outbound",
  "transcription",
  "followup",
  "notification",
  "dead-letter",
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export interface AddOptions {
  /** Delay before the job becomes processable (ms). */
  delayMs?: number;
}

export interface Producer<T> {
  readonly name: QueueName;
  add(data: T, opts?: AddOptions): Promise<void>;
}

export type JobHandler<T> = (data: T) => Promise<void>;

export interface Closable {
  close(): Promise<void>;
}

export interface QueueProvider extends Closable {
  /** Get a producer for a queue. */
  queue<T = unknown>(name: QueueName): Producer<T>;
  /** Start a worker that consumes a queue with `handler`. */
  worker<T = unknown>(name: QueueName, handler: JobHandler<T>): Closable;
}
