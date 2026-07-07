// P18 (Gap #33): Document training.
//
// Turns an uploaded clinic document (PDF / Word / plain text / FAQ) into a set of
// knowledge-base chunks ready for embedding. This module is pure transformation:
// it extracts text and splits it; persistence (knowledge_documents +
// knowledge_chunks) and embedding (the kb-embed queue) are the caller's job — the
// same split-of-concerns the rest of the agents package uses (see calbot).
//
// pdf-parse and mammoth are heavy and only needed on the binary paths, so they are
// imported lazily — merely loading the botbase barrel stays cheap and test-safe.
// Image (scan/photo) documents have no text layer, so they go through OCR (ocr.ts).

import { ocrImage } from './ocr.js'

export type DocumentFormat = 'pdf' | 'docx' | 'txt' | 'md' | 'faq' | 'image'

export interface TrainedChunk {
  content: string
  chunkIndex: number
  /** Present when the chunk came from a parsed Q/A pair. */
  question?: string
}

export interface TrainDocumentInput {
  /** Raw file bytes. For txt/md/faq this is the UTF-8 text. */
  buffer: Buffer
  format: DocumentFormat
  /** Soft cap on chunk size for prose splitting (default 800). */
  maxChunkChars?: number
}

const DEFAULT_MAX_CHARS = 800

/** Map a filename / MIME type to a supported format (defaults to plain text). */
export function detectFormat(filename: string, mimeType?: string): DocumentFormat {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.pdf') || mimeType === 'application/pdf') return 'pdf'
  if (
    lower.endsWith('.docx') ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }
  if (/\.(png|jpe?g|webp|tiff?|bmp|gif)$/.test(lower) || mimeType?.startsWith('image/')) {
    return 'image'
  }
  if (lower.endsWith('.md')) return 'md'
  return 'txt'
}

/** Formats that have no text layer and must be read with OCR. */
export function needsOcr(format: DocumentFormat): boolean {
  return format === 'image'
}

/** Extract plain text from a document buffer. */
export async function extractText(buffer: Buffer, format: DocumentFormat): Promise<string> {
  switch (format) {
    case 'pdf': {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      try {
        const result = await parser.getText()
        return result.text
      } finally {
        await parser.destroy()
      }
    }
    case 'docx': {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ buffer })
      return result.value
    }
    case 'image': {
      // Scanned/photographed document — recognise the text with OCR.
      return (await ocrImage(buffer)).text
    }
    case 'txt':
    case 'md':
    case 'faq':
      return buffer.toString('utf-8')
  }
}

export interface QAPair {
  question: string
  answer: string
}

/**
 * Parse a "Q:/A:" FAQ document into question/answer pairs. Lines that begin with
 * `Q:` open a pair; following `A:` (and continuation) lines are its answer. Lines
 * before the first `Q:` are ignored.
 */
export function parseFaqPairs(text: string): QAPair[] {
  const pairs: QAPair[] = []
  let current: { question: string; answer: string[] } | null = null
  let mode: 'q' | 'a' = 'q'

  const flush = () => {
    if (current && current.question.trim()) {
      pairs.push({ question: current.question.trim(), answer: current.answer.join('\n').trim() })
    }
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const q = line.match(/^q\s*[:.\-)]\s*(.*)$/i)
    const a = line.match(/^a\s*[:.\-)]\s*(.*)$/i)
    if (q) {
      flush()
      current = { question: q[1] ?? '', answer: [] }
      mode = 'q'
    } else if (a && current) {
      current.answer.push(a[1] ?? '')
      mode = 'a'
    } else if (current && line) {
      // Continuation of whichever part we're in.
      if (mode === 'q') current.question += ` ${line}`
      else current.answer.push(line)
    }
  }
  flush()
  return pairs
}

/** True when the text is dominated by `Q:`-style lines (auto-detect FAQ docs). */
export function looksLikeFaq(text: string): boolean {
  return /^\s*q\s*[:.\-)]/im.test(text) && /^\s*a\s*[:.\-)]/im.test(text)
}

/**
 * Split prose into chunks no larger than `maxChars`, preferring paragraph then
 * sentence boundaries so a chunk stays semantically whole.
 */
export function chunkText(text: string, maxChars = DEFAULT_MAX_CHARS): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const chunks: string[] = []
  let buffer = ''

  const push = () => {
    if (buffer.trim()) chunks.push(buffer.trim())
    buffer = ''
  }

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      push()
      // Oversized paragraph: break on sentence ends.
      let sentenceBuf = ''
      for (const sentence of para.split(/(?<=[.!?])\s+/)) {
        if ((sentenceBuf + ' ' + sentence).trim().length > maxChars && sentenceBuf) {
          chunks.push(sentenceBuf.trim())
          sentenceBuf = sentence
        } else {
          sentenceBuf = sentenceBuf ? `${sentenceBuf} ${sentence}` : sentence
        }
      }
      if (sentenceBuf.trim()) chunks.push(sentenceBuf.trim())
    } else if ((buffer + '\n\n' + para).trim().length > maxChars) {
      push()
      buffer = para
    } else {
      buffer = buffer ? `${buffer}\n\n${para}` : para
    }
  }
  push()
  return chunks
}

/**
 * Extract → split a document into KB chunks. FAQ docs (explicit `faq` format or
 * auto-detected) become one chunk per Q/A pair; everything else is prose-chunked.
 */
export async function trainDocument(input: TrainDocumentInput): Promise<TrainedChunk[]> {
  const maxChars = input.maxChunkChars ?? DEFAULT_MAX_CHARS
  const text = (await extractText(input.buffer, input.format)).trim()
  if (!text) return []

  if (input.format === 'faq' || looksLikeFaq(text)) {
    const pairs = parseFaqPairs(text)
    if (pairs.length > 0) {
      return pairs.map((pair, i) => ({
        content: `Q: ${pair.question}\nA: ${pair.answer}`,
        chunkIndex: i,
        question: pair.question,
      }))
    }
  }

  return chunkText(text, maxChars).map((content, i) => ({ content, chunkIndex: i }))
}
