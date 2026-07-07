import { describe, it, expect } from 'vitest'
import { trainingInfo, sourceInfo, needsReview } from './kbTraining'

describe('trainingInfo', () => {
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
