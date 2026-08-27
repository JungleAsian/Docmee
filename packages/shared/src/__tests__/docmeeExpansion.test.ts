import { describe, expect, it } from 'vitest'
import { assertAutomationAllowed, isHumanOnly, readInboxSettings } from '../docmeeExpansion.js'

describe('Docmee expansion contracts', () => {
  it('keeps human-only independent from consent tags', () => {
    expect(isHumanOnly({ automationMode: 'human_only' })).toBe(true)
    expect(isHumanOnly({ automationMode: 'automated' })).toBe(false)
    expect(isHumanOnly({ automationMode: 'human_only', optedOut: true })).toBe(true)
  })
  it('blocks immediately before automated work', () => {
    expect(() => assertAutomationAllowed({ automationMode: 'human_only' })).toThrow('automation_suppressed_human_only')
    expect(() => assertAutomationAllowed({ automationMode: 'automated' })).not.toThrow()
  })
  it('normalizes malformed settings and preserves safety visibility', () => {
    const result = readInboxSettings({ patientChatVisibility: { safetyHandoff: false, tags: 'bad' } })
    expect(result.inboxLayout.calendarExpanded).toBe(true)
    expect(result.patientChatVisibility.safetyHandoff).toBe(false)
    expect(result.patientChatVisibility.tags).toBe(false)
    expect(result.patientChatVisibility.aiAssistance).toBe(true)
  })
})
