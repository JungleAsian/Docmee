import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeSearchRow } from '@docmee/db'
import { clearSharedKbEvidenceCache, retrieveKbEvidence } from '../botbase/kb-evidence-pack.js'
import { createLayaAdapter, type LayaMode, type LayaRequest } from '../laya/adapter.js'

function row(index: number, overrides: Partial<KnowledgeSearchRow> = {}): KnowledgeSearchRow {
  return { chunkId: `chunk-${index}`, documentId: `doc-${index}`, title: `Fact ${index}`,
    content: `Clinic information ${index}`, doctorId: null, language: 'en', documentVersion: 1,
    updatedAt: '2026-09-25T00:00:00Z', vectorScore: 0.95 - index / 100, lexicalScore: 0.8 - index / 100,
    retrievalRevision: 1, contentHash: `hash-${index}`, conflictState: 'clear', ...overrides }
}
function fixture(mode: LayaMode = 'live', afterInference?: () => void) {
  const transport = vi.fn(async (request: LayaRequest) => {
    afterInference?.()
    return { schemaVersion: 1, requestId: request.requestId, modelVersion: 'm1', calibrationVersion: 'c1',
      choiceId: 'evidence-2', rawScore: 0.99, abstain: false }
  })
  const adapter = createLayaAdapter({ transport, readControls: async () => ({ enabled: true,
    maximumMode: mode, clinicMode: mode, tasks: ['kb_relevance'], qualification: {
      reviewed: true, modelVersion: 'm1', calibrationVersion: 'c1', thresholds: { 'kb_relevance:en': 0.9 },
    } }) })
  return { adapter, transport }
}
function input(rows = [row(1), row(2)]) {
  return { clinicId: 'clinic-a', question: 'Tell me the hours', language: 'en' as const,
    knowledge: { getClinicRetrievalRevision: async () => 1, searchChunks: async () => rows },
    embed: async () => [1], sourcesCurrent: async () => true }
}

describe('optional LAYA ranking in shared KB retrieval', () => {
  beforeEach(() => clearSharedKbEvidenceCache())

  it.each(['baseline', 'disabled', 'live'] as const)(
    'binds currentness to the server query plan, including cached retrieval in %s mode', async mode => {
      const sourcesCurrent = vi.fn(async (..._args: unknown[]) => true)
      const config = { ...input([row(1, { language: 'es', doctorId: 'doctor-1' })]),
        language: 'es' as const, doctorId: 'doctor-1', sourcesCurrent,
        layaAdapter: mode === 'baseline' ? undefined : fixture(mode).adapter }
      await retrieveKbEvidence(config)
      const cached = await retrieveKbEvidence(config)
      expect(cached.cacheHit).toBe(true)
      expect(sourcesCurrent).toHaveBeenCalled()
      for (const call of sourcesCurrent.mock.calls) {
        expect(call[2]).toEqual({ doctorId: 'doctor-1', language: 'es' })
      }
    })

  it('promotes only an existing passage and keeps citations and context aligned', async () => {
    const { adapter, transport } = fixture()
    const result = await retrieveKbEvidence({ ...input(), layaAdapter: adapter })
    expect(result.matches.map(match => match.chunkId)).toEqual(['chunk-2', 'chunk-1'])
    expect(result.citations.map(citation => citation.chunkId)).toEqual(['chunk-2', 'chunk-1'])
    expect(result.context).toBe('[Fact 2]\nClinic information 2\n\n[Fact 1]\nClinic information 1')
    const wire = JSON.stringify(transport.mock.calls[0]![0])
    expect(wire).not.toContain('clinic-a'); expect(wire).not.toContain('doc-1'); expect(wire).not.toContain('chunk-1')
  })

  it.each<LayaMode>(['disabled', 'shadow', 'advisory'])('preserves baseline order in %s mode', async mode => {
    const { adapter, transport } = fixture(mode)
    const result = await retrieveKbEvidence({ ...input(), layaAdapter: adapter })
    expect(result.matches.map(match => match.chunkId)).toEqual(['chunk-1', 'chunk-2'])
    if (mode === 'disabled') expect(transport).not.toHaveBeenCalled()
    else expect(transport).toHaveBeenCalledOnce()
  })

  it('does not disclose evidence without a server-owned currentness proof', async () => {
    const { adapter, transport } = fixture()
    await retrieveKbEvidence({ ...input(), sourcesCurrent: undefined, layaAdapter: adapter })
    expect(transport).not.toHaveBeenCalled()
  })

  it.each<Partial<KnowledgeSearchRow>>([{ language: 'es' }, { provenance: { governanceReviewState: 'excluded' } }])(
    'preserves baseline eligibility with a disabled adapter: %j', async override => {
      const config = input([row(1, override)])
      const baseline = await retrieveKbEvidence(config)
      const { adapter, transport } = fixture('disabled')
      const actual = await retrieveKbEvidence({ ...config, layaAdapter: adapter })
      expect(actual.status).toBe(baseline.status)
      expect(actual.matches).toEqual(baseline.matches)
      expect(transport).not.toHaveBeenCalled()
    })

  it('preserves baseline currentness timing when disabled', async () => {
    vi.useFakeTimers()
    try {
      const { adapter } = fixture('disabled')
      const result = retrieveKbEvidence({ ...input(), layaAdapter: adapter,
        sourcesCurrent: () => new Promise(resolve => setTimeout(() => resolve(true), 900)) })
      await vi.advanceTimersByTimeAsync(2000)
      expect((await result).status).toBe('ready')
    } finally { vi.useRealTimers() }
  })

  it.each([true, false])('keeps baseline currentness when LAYA control capacity is busy (current=%s)', async current => {
    let release!: () => void
    const transport = vi.fn()
    const adapter = createLayaAdapter({ transport,
      readControls: async () => {
        await new Promise<void>(resolve => { release = resolve })
        throw new Error('controls unavailable')
      } })
    const occupied = adapter.taskMode('clinic-a', 'kb_relevance')
    await Promise.resolve()
    try {
      const sourcesCurrent = vi.fn(async () => current)
      const result = await retrieveKbEvidence({ ...input(), sourcesCurrent, layaAdapter: adapter })
      expect(result.status).toBe(current ? 'ready' : 'stale_sources')
      expect(result.matches.map(match => match.chunkId)).toEqual(['chunk-1', 'chunk-2'])
      expect(sourcesCurrent).toHaveBeenCalledOnce()
      expect(transport).not.toHaveBeenCalled()
    } finally {
      release()
      await occupied
    }
  })

  it.each([true, false])('falls back without disclosure when control reads hang (current=%s)', async current => {
    vi.useFakeTimers()
    try {
      const transport = vi.fn()
      const readControls = vi.fn(() => new Promise<never>(() => {}))
      const adapter = createLayaAdapter({ transport, readControls, timeoutMs: 10 })
      const sourcesCurrent = vi.fn(async () => current)
      const config = { ...input(), sourcesCurrent, layaAdapter: adapter }
      const pending = retrieveKbEvidence(config)
      await vi.advanceTimersByTimeAsync(20)
      expect((await pending).status).toBe(current ? 'ready' : 'stale_sources')
      // The hung operation retains its slot, but the next request still uses baseline proof.
      expect((await retrieveKbEvidence(config)).status).toBe(current ? 'ready' : 'stale_sources')
      expect(readControls).toHaveBeenCalledOnce()
      expect(sourcesCurrent).toHaveBeenCalledTimes(2)
      expect(transport).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('rejects stale evidence before disclosure', async () => {
    const { adapter, transport } = fixture()
    const result = await retrieveKbEvidence({ ...input(), sourcesCurrent: async () => false, layaAdapter: adapter })
    expect(result.status).toBe('stale_sources'); expect(transport).not.toHaveBeenCalled()
  })

  it.each<Partial<KnowledgeSearchRow>>([
    { doctorId: 'other-doctor' }, { language: 'es' }, { provenance: { governanceReviewState: 'excluded' } },
    { effectiveUntil: '2000-01-01T00:00:00Z' }, { effectiveFrom: '9999-01-01T00:00:00Z' },
    { effectiveFrom: 'invalid-date' }, { retrievalRevision: 2 },
  ])('rejects a passage outside the permitted scope before disclosure: %j', async override => {
    const { adapter, transport } = fixture()
    const result = await retrieveKbEvidence({ ...input([row(1, override), row(2)]), layaAdapter: adapter })
    expect(result.status).toBe('stale_sources')
    expect(transport).not.toHaveBeenCalled()
  })

  it('marks evidence stale if revoked during inference instead of applying the ranking', async () => {
    let current = true
    const { adapter } = fixture('live', () => { current = false })
    const result = await retrieveKbEvidence({ ...input(), sourcesCurrent: async () => current, layaAdapter: adapter })
    expect(result.status).toBe('stale_sources')
    expect(result.matches.map(match => match.chunkId)).toEqual(['chunk-1', 'chunk-2'])
  })

  it('checks controls again for cached evidence instead of caching a live ranking', async () => {
    const config = input(); const live = fixture(); const disabled = fixture('disabled')
    await retrieveKbEvidence({ ...config, layaAdapter: live.adapter })
    const result = await retrieveKbEvidence({ ...config, layaAdapter: disabled.adapter })
    expect(result.cacheHit).toBe(true)
    expect(result.matches.map(match => match.chunkId)).toEqual(['chunk-1', 'chunk-2'])
    expect(disabled.transport).not.toHaveBeenCalled()
  })

  it('fails closed on unavailable proof without disclosing evidence', async () => {
    const { adapter, transport } = fixture()
    const result = await retrieveKbEvidence({ ...input(), sourcesCurrent: async () => { throw new Error('unavailable') }, layaAdapter: adapter })
    expect(result.status).toBe('stale_sources'); expect(transport).not.toHaveBeenCalled()
  })
})
