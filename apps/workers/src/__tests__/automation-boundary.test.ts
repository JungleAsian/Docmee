import { describe, expect, it } from 'vitest'
import { patientAllowsAutomation } from '../automation-boundary.js'

describe('patientAllowsAutomation', () => {
  it('blocks staff-opted-out patients while preserving normal automated patients', () => {
    expect(patientAllowsAutomation({ automationMode: 'automated', metadata: { staffOptedOut: true } } as never)).toBe(false)
    expect(patientAllowsAutomation({ automationMode: 'automated', metadata: { staffOptedOut: false } } as never)).toBe(true)
  })
})
