import { describe, it, expect } from 'vitest'
import {
  AUTOMATION_DEFS,
  readAutomations,
  isFollowUpEnabled,
  isReviewEnabled,
  activeCount,
  type AutomationsConfig,
} from './automations'

describe('AUTOMATION_DEFS', () => {
  it('models the six follow-up automations the worker schedules', () => {
    expect(AUTOMATION_DEFS.map((d) => d.type)).toEqual([
      'appointment_confirmation',
      'appointment_reminder',
      'post_consultation',
      'seven_day',
      'three_month',
      'no_response',
    ])
  })

  it('mirrors the worker fire times (24h/3h before, 2h/7d/90d after)', () => {
    const byType = Object.fromEntries(AUTOMATION_DEFS.map((d) => [d.type, d.offset]))
    expect(byType['appointment_confirmation']).toEqual({
      amount: 24,
      unit: 'hour',
      direction: 'before',
      anchor: 'appointment',
    })
    expect(byType['appointment_reminder']?.direction).toBe('before')
    expect(byType['post_consultation']).toEqual({
      amount: 2,
      unit: 'hour',
      direction: 'after',
      anchor: 'appointment',
    })
    expect(byType['seven_day']?.unit).toBe('day')
    expect(byType['three_month']?.amount).toBe(90)
    expect(byType['no_response']?.anchor).toBe('silence')
  })

  it('only confirmation + reminder have a template fallback outside the 24h window', () => {
    const fallback = AUTOMATION_DEFS.filter((d) => d.window === 'template_fallback').map((d) => d.type)
    expect(fallback).toEqual(['appointment_confirmation', 'appointment_reminder'])
  })
})

describe('config readers', () => {
  it('defaults every follow-up and the review request to ON when unconfigured', () => {
    const cfg = readAutomations({})
    expect(isReviewEnabled(cfg)).toBe(true)
    for (const def of AUTOMATION_DEFS) expect(isFollowUpEnabled(cfg, def.type)).toBe(true)
  })

  it('reads an explicit disable flag and leaves others on', () => {
    const cfg: AutomationsConfig = { followUps: { seven_day: false }, reviewRequest: { enabled: false } }
    expect(isFollowUpEnabled(cfg, 'seven_day')).toBe(false)
    expect(isFollowUpEnabled(cfg, 'three_month')).toBe(true)
    expect(isReviewEnabled(cfg)).toBe(false)
  })

  it('readAutomations tolerates a missing/garbage settings blob', () => {
    expect(readAutomations(null)).toEqual({})
    expect(readAutomations(undefined)).toEqual({})
    expect(readAutomations({ automations: 'nope' as unknown })).toEqual({})
  })

  it('activeCount counts enabled automations', () => {
    expect(activeCount({})).toEqual({ active: 6, total: 6 })
    expect(activeCount({ followUps: { seven_day: false, no_response: false } })).toEqual({
      active: 4,
      total: 6,
    })
  })
})
