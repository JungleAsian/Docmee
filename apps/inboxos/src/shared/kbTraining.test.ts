import { describe, it, expect } from 'vitest'
import { trainingInfo, sourceInfo, needsReview } from './kbTraining'

describe('trainingInfo', () => {
  const current = { status: 'active' as const, approvedAt: '2026-01-01', effectiveFrom: '2026-01-01', chunkCount: 2, embeddedCount: 0 }
  it('separates usable lexical chunks from failed or pending vector indexing', () => {
    expect(trainingInfo({ ...current, indexingStatus: 'failed' })).toMatchObject({ lexicalAvailable: true, state: 'failed' })
    expect(trainingInfo({ ...current, indexingStatus: 'pending' })).toMatchObject({ lexicalAvailable: true, state: 'queued' })
  })
  it('does not present pending reindexing as finished just because old vectors exist', () => {
    expect(trainingInfo({ ...current, embeddedCount: 2, indexingStatus: 'pending' }).state).toBe('queued')
  })
  it('requires approved current active content before claiming lexical availability', () => {
    for (const change of [{ status: 'draft' as const }, { approvedAt: null }, { effectiveFrom: '2099-01-01' }, { effectiveUntil: '2000-01-01' }, { indexingStatus: 'withdrawn' as const }, { metadata: { governanceReviewState: 'excluded' } }]) {
      expect(trainingInfo({ ...current, ...change }).lexicalAvailable).toBe(false)
    }
  })
  it('reports not_indexed when there are no chunks', () => {
    const info = trainingInfo({ chunkCount: 0, embeddedCount: 0 })
    expect(info.state).toBe('not_indexed')
    expect(info.progress).toBe(0)
  })

  it('treats missing counts as not_indexed', () => {
    expect(trainingInfo({}).state).toBe('not_indexed')
  })

  it('reports queued when chunks exist but none are embedded', () => {
    expect(trainingInfo({ chunkCount: 4, embeddedCount: 0 }).state).toBe('queued')
  })

  it('reports training while embedding is partial', () => {
    const info = trainingInfo({ chunkCount: 4, embeddedCount: 1 })
    expect(info.state).toBe('training')
    expect(info.progress).toBeCloseTo(0.25)
  })

  it('reports trained once every chunk is embedded', () => {
    const info = trainingInfo({ chunkCount: 3, embeddedCount: 3 })
    expect(info.state).toBe('trained')
    expect(info.progress).toBe(1)
  })
})

describe('sourceInfo', () => {
  it('distinguishes learned and unknown sources from human-authored text', () => {
    expect(sourceInfo({ metadata: { source: 'governed_learning' } })).toEqual({ source: 'governed_learning', confidence: 'medium' })
    expect(sourceInfo({ metadata: { source: 'imported' } })).toEqual({ source: 'unknown', confidence: 'low' })
  })
  it('treats unflagged documents as high-confidence manual entries', () => {
    expect(sourceInfo({ metadata: {} })).toEqual({ source: 'manual', confidence: 'high' })
    expect(sourceInfo({})).toEqual({ source: 'manual', confidence: 'high' })
  })

  it('treats parsed documents as medium confidence', () => {
    expect(sourceInfo({ metadata: { source: 'document' } })).toEqual({
      source: 'document',
      confidence: 'medium',
    })
  })

  it('treats OCR documents as low confidence', () => {
    expect(sourceInfo({ metadata: { source: 'document', ocr: true } })).toEqual({
      source: 'ocr',
      confidence: 'low',
    })
  })
})

describe('needsReview', () => {
  it('flags drafts', () => {
    expect(needsReview({ status: 'draft', metadata: {} })).toBe(true)
  })

  it('flags active OCR documents (low confidence)', () => {
    expect(needsReview({ status: 'active', metadata: { source: 'document', ocr: true } })).toBe(true)
  })

  it('does not flag an active manual entry', () => {
    expect(needsReview({ status: 'active', metadata: {} })).toBe(false)
  })
})
