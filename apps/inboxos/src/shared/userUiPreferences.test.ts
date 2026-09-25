import { describe, expect, it } from 'vitest'
import { normalizeUserUiPreferences, visibleOrderedItems } from './userUiPreferences'

describe('user UI preferences', () => {
  it('normalizes missing preference rows to safe defaults', () => {
    expect(normalizeUserUiPreferences(null).conversationListExpanded).toBe(true)
    expect(normalizeUserUiPreferences(null).imageBannersVisible).toBe(true)
    expect(normalizeUserUiPreferences(null).lastSeenProductUpdateId).toBeNull()
  })

  it('preserves a valid last-seen product update identifier', () => {
    expect(normalizeUserUiPreferences({ lastSeenProductUpdateId: '2026-09-24-product-updates-center' }).lastSeenProductUpdateId)
      .toBe('2026-09-24-product-updates-center')
  })

  it('rejects invalid last-seen product update identifiers', () => {
    expect(normalizeUserUiPreferences({ lastSeenProductUpdateId: 42 }).lastSeenProductUpdateId).toBeNull()
    expect(normalizeUserUiPreferences({ lastSeenProductUpdateId: '' }).lastSeenProductUpdateId).toBeNull()
  })

  it('keeps unauthorized hidden items from authorizing new menu access', () => {
    expect(visibleOrderedItems(['calendar', 'patient'], ['patient', 'calendar'], ['calendar'])).toEqual(['patient'])
  })

  it('appends newly introduced permitted items instead of silently hiding them', () => {
    expect(visibleOrderedItems(['patient'], ['patient', 'calendar', 'notes'], [])).toEqual(['patient', 'calendar', 'notes'])
  })
})
