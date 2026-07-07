// Screen 7 (Knowledge base editor) — pure helpers that derive the two operational
// signals the panel renders for each document: its TRAINING STATE (is the entry
// actually indexed and retrievable by the bot?) and its SOURCE CONFIDENCE (how much
// we trust the extracted text given where it came from). Both are derived from
// fields the API already returns (chunk counts + metadata) so there is no new column.
import type { KnowledgeDocument } from './types'

// The bot can only retrieve chunks that carry an embedding (knowledge.repository
// listEmbeddedChunks filters on an embedded vector of an `active` document), so the
// embedded-chunk count is the source of truth for "is this live for the bot?".
export type TrainingState = 'trained' | 'training' | 'queued' | 'not_indexed'

export interface TrainingInfo {
  state: TrainingState
  chunkCount: number
  embeddedCount: number
  /** 0..1 embedding progress, for the inline bar. 0 when there are no chunks. */
  progress: number
}

export function trainingInfo(doc: Pick<KnowledgeDocument, 'chunkCount' | 'embeddedCount'>): TrainingInfo {
  const chunkCount = doc.chunkCount ?? 0
  const embeddedCount = doc.embeddedCount ?? 0
  let state: TrainingState
  if (chunkCount === 0) state = 'not_indexed'
  else if (embeddedCount === 0) state = 'queued'
  else if (embeddedCount < chunkCount) state = 'training'
  else state = 'trained'
  return {
    state,
    chunkCount,
    embeddedCount,
    progress: chunkCount === 0 ? 0 : embeddedCount / chunkCount,
  }
}

// Where the entry's text came from. Manual = typed by a human in the editor;
// document = parsed from an uploaded PDF/Word/text file; ocr = recovered from a
// scanned image (most error-prone, lowest confidence).
export type KbSource = 'manual' | 'document' | 'ocr'
export type SourceConfidence = 'high' | 'medium' | 'low'

export interface SourceInfo {
  source: KbSource
  confidence: SourceConfidence
}

export function sourceInfo(doc: Pick<KnowledgeDocument, 'metadata'>): SourceInfo {
  const meta = doc.metadata ?? {}
  if (meta.source === 'document') {
    return meta.ocr ? { source: 'ocr', confidence: 'low' } : { source: 'document', confidence: 'medium' }
  }
  // Anything not flagged as an imported document is treated as hand-authored.
  return { source: 'manual', confidence: 'high' }
}

/** A document needs a human eye when it is still a draft OR its text came from a
 *  low-confidence source (OCR) — used to surface the review banner / row accent. */
export function needsReview(doc: Pick<KnowledgeDocument, 'status' | 'metadata'>): boolean {
  return doc.status === 'draft' || sourceInfo(doc).confidence === 'low'
}
