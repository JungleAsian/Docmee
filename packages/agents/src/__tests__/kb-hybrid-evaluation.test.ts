import { describe, expect, it } from 'vitest'
import { rankKeywordChunks, rerankHybridChunks } from '../botbase/kb-retriever.js'

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
})
