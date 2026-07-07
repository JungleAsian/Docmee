import { describe, it, expect } from 'vitest'

describe('@docmee/notifications', () => {
  it('package loads and exposes the P07 surface', async () => {
    const mod = await import('../index.js')
    expect(mod).toBeDefined()
    expect(typeof mod.sendEmail).toBe('function')
    expect(typeof mod.dispatchNotification).toBe('function')
    expect(typeof mod.buildNotificationEmail).toBe('function')
    expect(mod.NOTIFICATION_PRIORITY.emergency).toBe('p1')
    expect(Object.keys(mod.NOTIFICATION_TYPES)).toHaveLength(20)
  })
})
