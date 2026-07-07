import { describe, expect, it } from 'vitest'
import {
  compileActiveRules,
  parseClinicRules,
  rulesChanged,
  type ClinicRule,
} from './clinicRules'

describe('parseClinicRules', () => {
  it('prefers the structured list and defaults a missing active flag to true', () => {
    const rules = parseClinicRules({
      clinicRulesList: [
        { id: 'a', text: 'Confirm reason', active: true },
        { id: 'b', text: 'Same-day slot', active: false },
        { text: 'No id but active by default' },
      ],
    })
    expect(rules).toEqual([
      { id: 'a', text: 'Confirm reason', active: true },
      { id: 'b', text: 'Same-day slot', active: false },
      { id: 'rule-2', text: 'No id but active by default', active: true },
    ])
  })

  it('drops blank/garbled entries from the structured list', () => {
    const rules = parseClinicRules({
      clinicRulesList: [{ id: 'a', text: '   ', active: true }, null, 'nope', { active: true }],
    })
    expect(rules).toEqual([])
  })

  it('migrates a legacy newline string into active rules', () => {
    const rules = parseClinicRules({ clinicRules: 'Confirm reason\n\n  Same-day slot  \n' })
    expect(rules).toEqual([
      { id: 'legacy-0', text: 'Confirm reason', active: true },
      { id: 'legacy-1', text: 'Same-day slot', active: true },
    ])
  })

  it('returns an empty list when nothing is configured', () => {
    expect(parseClinicRules({})).toEqual([])
    expect(parseClinicRules({ clinicRules: '   ' })).toEqual([])
  })
})

describe('compileActiveRules', () => {
  it('joins only active, non-empty rules — inactive rules are invisible to the bot', () => {
    const rules: ClinicRule[] = [
      { id: 'a', text: 'Confirm reason', active: true },
      { id: 'b', text: 'Hidden rule', active: false },
      { id: 'c', text: 'Offer same-day slot', active: true },
    ]
    expect(compileActiveRules(rules)).toBe('Confirm reason\nOffer same-day slot')
  })

  it('returns an empty string when every rule is inactive', () => {
    const rules: ClinicRule[] = [{ id: 'a', text: 'Off', active: false }]
    expect(compileActiveRules(rules)).toBe('')
  })
})

describe('rulesChanged', () => {
  const base: ClinicRule[] = [{ id: 'a', text: 'One', active: true }]
  it('detects text, active-flag, length and order changes', () => {
    expect(rulesChanged(base, base)).toBe(false)
    expect(rulesChanged(base, [{ id: 'a', text: 'Two', active: true }])).toBe(true)
    expect(rulesChanged(base, [{ id: 'a', text: 'One', active: false }])).toBe(true)
    expect(rulesChanged(base, [])).toBe(true)
  })
})
