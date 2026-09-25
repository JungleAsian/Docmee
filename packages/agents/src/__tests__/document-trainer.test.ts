import { describe, it, expect } from 'vitest'
import {
  parseFaqPairs,
  looksLikeFaq,
  chunkText,
  detectFormat,
  needsOcr,
  trainDocument,
  toCanonicalMarkdown,
  convertDocumentToMarkdown,
} from '../botbase/document-trainer.js'

describe('detectFormat', () => {
  it('maps extensions and mime types', () => {
    expect(detectFormat('a.pdf')).toBe('pdf')
    expect(detectFormat('a.docx')).toBe('docx')
    expect(detectFormat('notes.md')).toBe('md')
    expect(detectFormat('plain.txt')).toBe('txt')
    expect(detectFormat('file', 'application/pdf')).toBe('pdf')
  })

  it('maps scanned image extensions and mime types to image (OCR)', () => {
    expect(detectFormat('scan.png')).toBe('image')
    expect(detectFormat('photo.jpg')).toBe('image')
    expect(detectFormat('photo.jpeg')).toBe('image')
    expect(detectFormat('fax.tiff')).toBe('image')
    expect(detectFormat('blob', 'image/png')).toBe('image')
  })
})

describe('needsOcr', () => {
  it('flags image documents for OCR and leaves text formats alone', () => {
    expect(needsOcr('image')).toBe(true)
    expect(needsOcr('pdf')).toBe(false)
    expect(needsOcr('txt')).toBe(false)
  })
})

describe('parseFaqPairs', () => {
  it('extracts Q/A pairs and ignores preamble', () => {
    const text = 'intro line\nQ: ¿Horario?\nA: 9 a 18h\nQ: ¿Precio?\nA: 100 GTQ'
    const pairs = parseFaqPairs(text)
    expect(pairs).toEqual([
      { question: '¿Horario?', answer: '9 a 18h' },
      { question: '¿Precio?', answer: '100 GTQ' },
    ])
  })

  it('joins multi-line answers', () => {
    const pairs = parseFaqPairs('Q: Test\nA: line one\nline two')
    expect(pairs[0]?.answer).toBe('line one\nline two')
  })
})

describe('looksLikeFaq', () => {
  it('detects Q:/A: documents', () => {
    expect(looksLikeFaq('Q: a\nA: b')).toBe(true)
    expect(looksLikeFaq('just some prose here')).toBe(false)
  })
})

describe('chunkText', () => {
  it('keeps small documents as one chunk', () => {
    expect(chunkText('short text', 800)).toEqual(['short text'])
  })

  it('splits prose that exceeds the cap', () => {
    const para = 'a'.repeat(500)
    const chunks = chunkText(`${para}\n\n${para}`, 800)
    expect(chunks.length).toBe(2)
  })
})

describe('trainDocument', () => {
  it('produces one chunk per Q/A pair for FAQ text', async () => {
    const buffer = Buffer.from('Q: One\nA: First\nQ: Two\nA: Second', 'utf-8')
    const chunks = await trainDocument({ buffer, format: 'faq' })
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toMatchObject({ chunkIndex: 0, question: 'One' })
    expect(chunks[0]?.content).toContain('A: First')
  })

  it('prose-chunks a plain text document', async () => {
    const chunks = await trainDocument({ buffer: Buffer.from('Hello world.', 'utf-8'), format: 'txt' })
    expect(chunks).toMatchObject([{ content: 'Hello world.', chunkIndex: 0 }])
    expect(chunks[0]?.metadata).toMatchObject({ language: 'en', tokenCount: 2 })
    expect(chunks[0]?.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('adds section and canonical fact metadata to Markdown chunks', async () => {
    const chunks = await trainDocument({
      buffer: Buffer.from('# Clinic\n\n## Hours\n\nOpen weekdays from 9 to 5.', 'utf-8'),
      format: 'md',
    })
    const hours = chunks.find(chunk => chunk.metadata.sectionPath.includes('Hours'))
    expect(hours?.metadata.sectionPath).toEqual(['Clinic', 'Hours'])
    expect(hours?.metadata.sourceSpan).toEqual({ startLine: 3, endLine: 5 })
    expect(hours?.metadata.canonicalFactKey).toBeTruthy()
  })

  it('keeps a Markdown table with its heading instead of splitting table rows', async () => {
    const chunks = await trainDocument({
      buffer: Buffer.from('## Prices\n\n| Service | Price |\n| --- | --- |\n| Visit | 100 |\n| Follow-up | 50 |', 'utf-8'),
      format: 'md',
      maxChunkChars: 200,
    })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.content).toContain('| Follow-up | 50 |')
    expect(chunks[0]?.metadata.sectionPath).toEqual(['Prices'])
  })

  it('returns no chunks for an empty document', async () => {
    expect(await trainDocument({ buffer: Buffer.from('   ', 'utf-8'), format: 'txt' })).toEqual([])
  })

  it('OCRs an image document and chunks the recognised text (LLM_STUB)', async () => {
    // With LLM_STUB the OCR engine is never loaded; the stub text is chunked.
    const chunks = await trainDocument({ buffer: Buffer.from('fake-image-bytes'), format: 'image' })
    expect(chunks.length).toBeGreaterThan(0)
    expect(chunks[0]?.content).toContain('Horario de atención')
  })
})

describe('Markdown conversion', () => {
  it('turns extracted plain text into a canonical Markdown source', () => {
    expect(toCanonicalMarkdown({ fileName: 'clinic-policy.pdf', text: 'Open Monday through Friday.' })).toBe(
      '# clinic policy\n\nOpen Monday through Friday.\n',
    )
  })

  it('preserves an existing Markdown heading', () => {
    expect(toCanonicalMarkdown({ fileName: 'ignored.txt', text: '# Hours\n\n9 AM to 5 PM' })).toBe(
      '# Hours\n\n9 AM to 5 PM\n',
    )
  })

  it('trains the generated Markdown rather than retaining raw input bytes', async () => {
    const result = await convertDocumentToMarkdown({
      fileName: 'welcome.txt',
      buffer: Buffer.from('Welcome to the clinic.', 'utf-8'),
      format: 'txt',
    })
    expect(result.markdown).toBe('# welcome\n\nWelcome to the clinic.\n')
    expect(result.chunks).toMatchObject([{ content: '# welcome\n\nWelcome to the clinic.', chunkIndex: 0 }])
  })
})
