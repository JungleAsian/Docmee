import { describe, expect, it } from 'vitest'
import { fuseKbCandidates, rankKeywordChunks, rerankHybridChunks } from '../botbase/kb-retriever.js'
import { planKbQuery } from '../botbase/kb-query-plan.js'

describe('KB hybrid retrieval evaluation cases', () => {
  const cases = [
    ['English', 'acne treatment', 'Acne treatment and consultation'],
    ['Spanish', 'que es el acne', '¿Qué es el acné?'],
    ['synonym', 'skin pimples', 'Acne and pimples FAQ'],
    ['misspelling', 'acnee', 'Acne information'],
  ] as const

  it.each(cases)('finds a grounded answer for %s questions', (_name, query, title) => {
    expect(rankKeywordChunks(query, [{ title, content: `${title}. Ask the clinic for an evaluation.` }])).toHaveLength(1)
  })

  it('prefers the newest approved version when old and new entries conflict', () => {
    const matches = rerankHybridChunks([
      { title: 'Old policy', content: 'old answer', similarity: 0, vectorScore: 0.91, lexicalScore: 0.5, documentVersion: 1 },
      { title: 'Current policy', content: 'new answer', similarity: 0, vectorScore: 0.91, lexicalScore: 0.5, documentVersion: 2 },
    ])
    expect(matches[0]?.title).toBe('Current policy')
  })

  it('returns no result for ungrounded text so the caller can hand off', () => {
    expect(rerankHybridChunks([{ title: 'KB', content: 'answer', similarity: 0, vectorScore: 0.2, lexicalScore: 0 }])).toEqual([])
  })

  it('fuses semantic and lexical ranks, rejects conflicts, and deduplicates identical facts', () => {
    const matches = fuseKbCandidates([
      { title: 'Semantic only', content: 'Open weekdays', similarity: 0, vectorScore: 0.92, lexicalScore: 0, semanticRank: 1, lexicalRank: 9, canonicalFactKey: 'hours', contentHash: 'current' },
      { title: 'Balanced current', content: 'Open weekdays', similarity: 0, vectorScore: 0.88, lexicalScore: 0.8, semanticRank: 2, lexicalRank: 1, canonicalFactKey: 'hours', contentHash: 'current' },
      { title: 'Conflicting', content: 'Open every day', similarity: 0, vectorScore: 0.99, lexicalScore: 1, semanticRank: 1, lexicalRank: 1, canonicalFactKey: 'hours', contentHash: 'conflict', conflictState: 'conflicting' },
      { title: 'Location', content: 'Main Street', similarity: 0, vectorScore: 0.86, lexicalScore: 0.6, semanticRank: 3, lexicalRank: 2, canonicalFactKey: 'location', contentHash: 'location' },
    ], planKbQuery('What are your hours?', { language: 'en' }))

    expect(matches.map((match) => match.title)).toEqual(['Balanced current', 'Location'])
  })
})
