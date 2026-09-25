import { describe, expect, it } from 'vitest'
import { fuseKbCandidates } from '../botbase/kb-retriever.js'
import { planKbQuery } from '../botbase/kb-query-plan.js'
import { KB_RETRIEVAL_EVAL_CASES } from './fixtures/kb-retrieval-eval.js'

describe('held-out KB retrieval quality gate', () => {
  it('keeps expected evidence at rank one with no governed-source leakage', () => {
    let hits = 0
    let returned = 0
    let governedLeakage = 0

    for (const sample of KB_RETRIEVAL_EVAL_CASES) {
      const plan = planKbQuery(sample.query, { language: sample.language, doctorId: sample.doctorId })
      const matches = fuseKbCandidates(sample.candidates, plan, 3)
      if (matches[0]?.contentHash === sample.expectedContentHash) hits += 1
      returned += matches.length
      governedLeakage += matches.filter(match => match.conflictState === 'conflicting' || match.conflictState === 'superseded').length
      expect(new Set(matches.map(match => match.contentHash)).size).toBe(matches.length)
    }

    const recallAtOne = hits / KB_RETRIEVAL_EVAL_CASES.length
    expect(recallAtOne).toBeGreaterThanOrEqual(.95)
    expect(governedLeakage).toBe(0)
    expect(returned).toBeGreaterThanOrEqual(KB_RETRIEVAL_EVAL_CASES.length)
  })

  it('returns no patient evidence when every candidate is conflicting', () => {
    const conflicted = KB_RETRIEVAL_EVAL_CASES[0]!.candidates.map(item => ({ ...item, conflictState: 'conflicting' as const }))
    expect(fuseKbCandidates(conflicted, { language: 'en' })).toEqual([])
  })
})
