import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB loads.
// The upload route (P18 Gap #33) extracts + chunks a document, persists it as a
// `draft` knowledge document, and enqueues each chunk for embedding.
const kbEmbedAdd = vi.hoisted(() => vi.fn())
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: kbEmbedAdd },
}))

// trainDocument is the only piece with heavy native deps (pdf-parse/mammoth/OCR);
// stub it so the test exercises the route's persistence + queueing glue, not the
// extractor (which has its own unit suite in @docmee/agents). detectFormat/needsOcr
// keep their real shape so the `ocr` flag in the response is covered.
const trainDocument = vi.hoisted(() => vi.fn())
vi.mock('@docmee/agents', () => ({
  getOAuth2Client: () => ({}),
  trainDocument,
  detectFormat: (filename: string) => (/\.(png|jpe?g|webp)$/i.test(filename) ? 'image' : 'txt'),
  needsOcr: (format: string) => format === 'image',
}))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

let nextId = 1
const created = vi.hoisted(() => ({ documents: [] as Record<string, unknown>[], chunks: [] as Record<string, unknown>[] }))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createDoctorsRepository: () => ({ findById: async () => null }),
  createKnowledgeRepository: () => ({
    listDocuments: async () => [],
    documentTrainingStats: async () => [],
    createDocument: async (data: Record<string, unknown>) => {
      const row = { id: `kb-new-${nextId++}`, ...data }
      created.documents.push(row)
      return row
    },
    createChunk: async (data: Record<string, unknown>) => {
      const row = { id: `chunk-${nextId++}`, ...data }
      created.chunks.push(row)
      return row
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const adminAuth = { authorization: `Bearer ${signAccessToken({ userId: 'ca-1', clinicId: 'c-1', role: 'clinic_admin', email: 'ca@d.test' })}` }
const secretaryAuth = { authorization: `Bearer ${signAccessToken({ userId: 'u-1', clinicId: 'c-1', role: 'secretary', email: 'a@d.test' })}` }

// Minimal multipart/form-data body (one file part), matching the encoding
// @fastify/multipart expects for request.file().
const BOUNDARY = '----docmeekbuploadboundary'
function filePayload({
  filename = 'policy.txt',
  contentType = 'text/plain',
  bytes = 'hello world',
}: { filename?: string; contentType?: string; bytes?: string } = {}) {
  const body =
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: ${contentType}\r\n\r\n${bytes}\r\n` +
    `--${BOUNDARY}--\r\n`
  return Buffer.from(body, 'utf8')
}
const multipartHeaders = (auth: Record<string, string>) => ({
  ...auth,
  'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
})

describe('KB document-upload route (P18 Gap #33 — document training)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('POST (admin) trains a document → draft doc + one queued embed per chunk', async () => {
    created.documents.length = 0
    created.chunks.length = 0
    kbEmbedAdd.mockClear()
    trainDocument.mockResolvedValueOnce([
      { content: 'chunk one', chunkIndex: 0 },
      { content: 'chunk two', chunkIndex: 1 },
    ])

    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/kb/upload',
      headers: multipartHeaders(adminAuth),
      payload: filePayload(),
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.chunks).toBe(2)
    expect(body.status).toBe('draft')
    expect(body.ocr).toBe(false)
    // Document lands as draft for human review before the bot can retrieve it.
    expect(created.documents[0]).toMatchObject({ status: 'draft', clinicId: 'c-1' })
    // One embed job per chunk, same shape the kb-embed worker consumes.
    expect(kbEmbedAdd).toHaveBeenCalledTimes(2)
    expect(kbEmbedAdd).toHaveBeenCalledWith('embed', expect.objectContaining({ clinicId: 'c-1', content: 'chunk one' }))
  })

  it('POST flags OCR for an image document', async () => {
    trainDocument.mockResolvedValueOnce([{ content: 'scanned text', chunkIndex: 0 }])
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/kb/upload',
      headers: multipartHeaders(adminAuth),
      payload: filePayload({ filename: 'scan.png', contentType: 'image/png' }),
    })
    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body).ocr).toBe(true)
  })

  it('POST (secretary) → 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/kb/upload',
      headers: multipartHeaders(secretaryAuth),
      payload: filePayload(),
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST without auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/kb/upload',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: filePayload(),
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST with no file part → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/kb/upload',
      headers: multipartHeaders(adminAuth),
      payload: Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST → 422 when the document yields no extractable content', async () => {
    trainDocument.mockResolvedValueOnce([])
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/kb/upload',
      headers: multipartHeaders(adminAuth),
      payload: filePayload(),
    })
    expect(res.statusCode).toBe(422)
  })

  it('POST → 422 when extraction throws', async () => {
    trainDocument.mockRejectedValueOnce(new Error('corrupt pdf'))
    const res = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/kb/upload',
      headers: multipartHeaders(adminAuth),
      payload: filePayload({ filename: 'broken.pdf', contentType: 'application/pdf' }),
    })
    expect(res.statusCode).toBe(422)
  })
})
