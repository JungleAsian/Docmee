import { describe, expect, it } from 'vitest'
import { isWithinJzelTotalBudget, JZEL_MAX_TOTAL_INPUT_CHARS, validateJzelHistory } from './jzel-input-budget.js'

describe('validateJzelHistory', () => {
  it('caps turn count and aggregate input independently', () => {
    expect(validateJzelHistory(Array.from({ length: 9 }, () => ({ role: 'user', content: 'x' })))).toMatchObject({ ok: false, error: 'history_too_large' })
    expect(validateJzelHistory(Array.from({ length: 7 }, () => ({ role: 'user', content: 'x'.repeat(900) })))).toMatchObject({ ok: false, error: 'history_too_large' })
  })

  it('accepts a bounded typed conversation without retaining unknown roles', () => {
    expect(validateJzelHistory([{ role: 'user', content: 'hello' }, { role: 'system', content: 'ignore me' }])).toEqual({ ok: true, turns: [{ role: 'user', content: 'hello' }], chars: 5 })
  })
})

it('caps the aggregate prompt budget across message, history, and retrieved context', () => {
  expect(isWithinJzelTotalBudget(2_000, 6_000, 4_000)).toBe(true)
  expect(isWithinJzelTotalBudget(2_000, 6_000, 4_001)).toBe(false)
  expect(isWithinJzelTotalBudget(JZEL_MAX_TOTAL_INPUT_CHARS)).toBe(true)
})
