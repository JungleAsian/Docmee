/**
 * @docmee/queue — BullMQ wrapper + 6 queue definitions (architecture §12).
 * OWNER: Prime. Domain-agnostic: producers/workers carry whatever payload the
 * caller wires.
 */
export {
  QUEUE_NAMES,
  type QueueName,
  type Producer,
  type JobHandler,
  type QueueProvider,
  type Closable,
  type AddOptions,
} from "./types.js";
export { InMemoryQueueProvider } from "./memory.js";
export { BullMqQueueProvider } from "./bullmq.js";

import { InMemoryQueueProvider } from "./memory.js";
import { BullMqQueueProvider } from "./bullmq.js";
import type { QueueProvider } from "./types.js";

/** Pick the provider from env: BullMQ when REDIS_URL is set, else in-memory. */
export function createQueueProvider(redisUrl?: string): QueueProvider {
  return redisUrl ? new BullMqQueueProvider(redisUrl) : new InMemoryQueueProvider();
}
