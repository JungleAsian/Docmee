import { describe, it, expect } from 'vitest'

describe('@docmee/channels', () => {
  it('package loads and exports the channel surface', async () => {
    const mod = await import('../index.js')
    expect(mod).toBeDefined()
    expect(typeof mod.createWhatsAppAdapter).toBe('function')
    expect(typeof mod.sendWhatsAppText).toBe('function')
    expect(typeof mod.sendTwilioWhatsAppText).toBe('function')
    expect(typeof mod.downloadMedia).toBe('function')
    expect(typeof mod.createDeepgramProvider).toBe('function')
  })
})
