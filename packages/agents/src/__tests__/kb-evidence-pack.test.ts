import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearSharedKbEvidenceCache, retrieveKbEvidence } from '../botbase/kb-evidence-pack.js'

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: 'chunk-1', documentId: 'doc-1', title: 'Clinic hours', content: 'Open Monday to Friday.',
    doctorId: null, language: 'en', documentVersion: 2, updatedAt: '2026-09-25T00:00:00.000Z',
    vectorScore: 0.91, lexicalScore: 0.5, source: 'clinic.md', retrievalRevision: 1,
    authority: 'clinic' as const, conflictState: 'clear' as const, contentHash: 'hash-1', ...overrides,
  }
}

describe('shared KB evidence pack', () => {
  beforeEach(() => clearSharedKbEvidenceCache())

  it('isolates clinic-scoped results and invalidates cache when the revision changes', async () => {
    let revision = 1
    const searchChunks = vi.fn(async (_query, _embedding, filters) => [candidate({
      chunkId: `${filters.clinicId}-chunk`, content: `${filters.clinicId} hours`, retrievalRevision: revision,
    })])
    const knowledge = {
      getClinicRetrievalRevision: vi.fn(async () => revision), searchChunks,
      recordRetrievalMetric: vi.fn(async () => undefined),
    }
    const embed = vi.fn(async () => [0.1, 0.2])

    const first = await retrieveKbEvidence({ clinicId: 'clinic-a', question: 'What are your hours?', knowledge, embed })
    const cached = await retrieveKbEvidence({ clinicId: 'clinic-a', question: 'What are your hours?', knowledge, embed })
    const otherClinic = await retrieveKbEvidence({ clinicId: 'clinic-b', question: 'What are your hours?', knowledge, embed })
    revision = 2
    const revised = await retrieveKbEvidence({ clinicId: 'clinic-a', question: 'What are your hours?', knowledge, embed })

    expect(first.matches[0]?.content).toBe('clinic-a hours')
    expect(cached.cacheHit).toBe(true)
    expect(otherClinic.matches[0]?.content).toBe('clinic-b hours')
    expect(revised.revision).toBe(2)
    expect(searchChunks).toHaveBeenCalledTimes(3)
    expect(embed).toHaveBeenCalledTimes(3)
  })

  it('excludes conflicts, deduplicates identical evidence, and caps context', async () => {
    const knowledge = {
      getClinicRetrievalRevision: vi.fn(async () => 4),
      searchChunks: vi.fn(async () => [
        candidate(),
        candidate({ chunkId: 'chunk-2', documentId: 'doc-2', title: 'Duplicate', contentHash: 'hash-1' }),
        candidate({ chunkId: 'chunk-3', documentId: 'doc-3', conflictState: 'conflicting', contentHash: 'hash-3' }),
        candidate({ chunkId: 'chunk-4', documentId: 'doc-4', content: 'Another fact', contentHash: 'hash-4', vectorScore: 0.89 }),
      ]),
      recordRetrievalMetric: vi.fn(async () => undefined),
    }

    const result = await retrieveKbEvidence({ clinicId: 'clinic-a', question: 'hours', knowledge, embed: async () => [1] })

    expect(result.matches.map(match => match.chunkId)).toEqual(['chunk-1', 'chunk-4'])
    expect(result.context).toContain('Open Monday to Friday.')
    expect(result.context).not.toContain('Duplicate')
    expect(result.citations).toHaveLength(2)
  })

  it('records only a query hash in retrieval metrics', async () => {
    const recordRetrievalMetric = vi.fn(async (_metric: { queryHash: string }) => undefined)
    const question = 'Does the clinic treat private condition 123?'
    await retrieveKbEvidence({
      clinicId: 'clinic-a', question, embed: async () => [1],
      knowledge: {
        getClinicRetrievalRevision: async () => 1,
        searchChunks: async () => [candidate()],
        recordRetrievalMetric,
      },
    })

    expect(recordRetrievalMetric).toHaveBeenCalledOnce()
    const metric = recordRetrievalMetric.mock.calls[0]![0]
    expect(metric.queryHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(metric)).not.toContain(question)
  })
})
