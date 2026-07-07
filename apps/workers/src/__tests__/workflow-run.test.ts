import { describe, it, expect } from 'vitest'
import { workflowKeywordMatches } from '../workflow-run.js'

const wf = (keywords: string) => ({
  nodes: [{ id: 't', kind: 'trigger' as const, type: 'trigger.message_keyword', config: { keywords }, x: 0, y: 0 }],
})

describe('workflowKeywordMatches', () => {
  it('matches when a keyword is contained (case-insensitive)', () => {
    expect(workflowKeywordMatches(wf('urgent, emergency'), 'This is URGENT please')).toBe(true)
  })

  it('does not match when no configured keyword is present', () => {
    expect(workflowKeywordMatches(wf('urgent'), 'just a routine question')).toBe(false)
  })

  it('matches every message when the keyword list is empty', () => {
    expect(workflowKeywordMatches(wf(''), 'anything at all')).toBe(true)
  })
})
