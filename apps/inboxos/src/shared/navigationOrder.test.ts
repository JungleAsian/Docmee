import { describe, expect, it } from 'vitest'
import { navigationOrderedItems } from './userUiPreferences'

describe('workspace navigation order', () => {
  it('places Waitlist immediately before Notifications even with a saved order', () => {
    expect(navigationOrderedItems(['/inbox', '/alerts', '/calendar', '/waitlist'], ['/inbox', '/calendar', '/alerts', '/waitlist'], [])).toEqual(['/inbox', '/waitlist', '/alerts', '/calendar'])
  })
  it('preserves hidden and role-restricted items and unrelated relative order', () => {
    expect(navigationOrderedItems(['/alerts', '/inbox', '/waitlist'], ['/inbox', '/alerts', '/waitlist'], ['/waitlist'])).toEqual(['/alerts', '/inbox'])
    expect(navigationOrderedItems(['/waitlist', '/inbox'], ['/inbox', '/alerts'], [])).toEqual(['/inbox', '/alerts'])
  })
})
