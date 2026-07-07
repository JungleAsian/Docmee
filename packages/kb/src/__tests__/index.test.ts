import { describe, it, expect } from 'vitest'

describe('@docmee/kb', () => {
  it('package loads', async () => {
    const mod = await import('../index.js')
    expect(mod).toBeDefined()
    expect(typeof mod.createKbRepo).toBe('function')
  })
})
