// Separate vector indexing progress from current approved lexical availability.
// Source provenance describes extraction risk, not clinical truth or answer confidence.
import type { KnowledgeDocument } from './types'

export type TrainingState = 'trained' | 'training' | 'queued' | 'not_indexed' | 'failed' | 'withdrawn'

export interface TrainingInfo {
  state: TrainingState
  chunkCount: number
  embeddedCount: number
  /** 0..1 embedding progress, for the inline bar. 0 when there are no chunks. */
  progress: number
  lexicalAvailable: boolean
}

export function trainingInfo(doc: Partial<KnowledgeDocument>, now = Date.now()): TrainingInfo {
  const chunkCount = doc.chunkCount ?? 0
  const embeddedCount = doc.embeddedCount ?? 0
  let state: TrainingState
  if (doc.indexingStatus === 'withdrawn') state = 'withdrawn'
  else if (doc.indexingStatus === 'failed') state = 'failed'
  else if (doc.indexingStatus === 'pending') state = 'queued'
  else if (chunkCount === 0) state = 'not_indexed'
  else if (embeddedCount === 0) state = 'queued'
  else if (embeddedCount < chunkCount) state = 'training'
  else state = 'trained'
  return {
    state,
    chunkCount,
    embeddedCount,
    progress: chunkCount === 0 ? 0 : Math.min(1, Math.max(0, embeddedCount / chunkCount)),
    lexicalAvailable: doc.status === 'active' && Boolean(doc.approvedAt) && chunkCount > 0
      && Boolean(doc.effectiveFrom) && Date.parse(doc.effectiveFrom!) <= now
      && (!doc.effectiveUntil || Date.parse(doc.effectiveUntil) > now)
      && doc.indexingStatus !== 'withdrawn'
      && !['excluded', 'archived'].includes(String(doc.metadata?.governanceReviewState ?? 'trusted')),
  }
}

// Where the entry's text came from. Manual = typed by a human in the editor;
// document = parsed from an uploaded PDF/Word/text file; ocr = recovered from a
// scanned image (most error-prone, lowest confidence).
export type KbSource = 'manual' | 'document' | 'ocr' | 'governed_learning' | 'unknown'
export type SourceConfidence = 'high' | 'medium' | 'low'

export interface SourceInfo {
  source: KbSource
  confidence: SourceConfidence
}

export function sourceInfo(doc: Pick<KnowledgeDocument, 'metadata'>): SourceInfo {
  const meta = doc.metadata ?? {}
  if (meta.source === 'governed_learning') return { source: 'governed_learning', confidence: 'medium' }
  if (meta.source === 'document') {
    return meta.ocr ? { source: 'ocr', confidence: 'low' } : { source: 'document', confidence: 'medium' }
  }
  if (meta.source && meta.source !== 'manual') return { source: 'unknown', confidence: 'low' }
  return { source: 'manual', confidence: 'high' }
}

/** A document needs a human eye when it is still a draft OR its text came from a
 *  low-confidence source (OCR) — used to surface the review banner / row accent. */
export function needsReview(doc: Pick<KnowledgeDocument, 'status' | 'metadata'>): boolean {
  return doc.status === 'draft' || sourceInfo(doc).confidence === 'low'
}
