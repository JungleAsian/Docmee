import { describe, it, expect, vi } from 'vitest'

// Replace the bullmq provider so importing the queue index does not open Redis connections.
vi.mock('../providers/bullmq.js', () => ({
  createQueue: (name: string) => ({ name, add: vi.fn() }),
  createWorker: vi.fn(),
  createQueueEvents: vi.fn(),
  createRedisConnection: vi.fn(),
}))

describe('@docmee/queue', () => {
  it('exports the queue factory and named queues', async () => {
    const mod = await import('../index.js')
    expect(typeof mod.createQueue).toBe('function')
    expect(typeof mod.createWorker).toBe('function')
    expect(mod.whatsappInboundQueue).toBeDefined()
    expect(mod.agentQueue).toBeDefined()
    expect(mod.kbEmbedQueue).toBeDefined()
  })
})
