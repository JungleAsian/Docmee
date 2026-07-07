import { describe, it, expect } from 'vitest'

describe('@docmee/agents', () => {
  // Importing the full barrel cold-transforms the whole package graph (incl. the
  // googleapis-typed calendar/sheets modules), which can exceed the 5s default on a
  // busy machine — give it room.
  it('package loads', async () => {
    const mod = await import('../index.js')
    expect(mod).toBeDefined()
    expect(typeof mod.routeMessage).toBe('function')
    expect(typeof mod.createGoogleCalendarClient).toBe('function')
  }, 30000)
})
