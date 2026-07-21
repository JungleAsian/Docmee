import { describe, expect, it } from 'vitest'
import { JZEL_MAX_HISTORY_CHARS, validateJzelHistory } from './jzel-input-budget.js'

describe('validateJzelHistory', () => {
  it('caps turn count and aggregate input independently', () => {
    expect(validateJzelHistory(Array.from({ length: 9 }, () => ({ role: 'user', content: 'x' })))).toMatchObject({ ok: false, error: 'history_too_large' })
    expect(validateJzelHistory(Array.from({ length: 7 }, () => ({ role: 'user', content: 'x'.repeat(900) })))).toMatchObject({ ok: false, error: 'history_too_large' })
  })

  it('accepts a bounded typed conversation without retaining unknown roles', () => {
    expect(validateJzelHistory([{ role: 'user', content: 'hello' }, { role: 'system', content: 'ignore me' }])).toEqual({ ok: true, turns: [{ role: 'user', content: 'hello' }], chars: 5 })
  })
})
