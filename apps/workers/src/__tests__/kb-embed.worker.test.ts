import { describe, it, expect, vi, beforeEach } from 'vitest'

// AI Knowledge Base per clinic (Req 7): embedding a chunk must be scoped to the
// owning clinic so a vector can never be written onto another clinic's row. We
// capture the tagged-template SQL call and assert both the chunk id AND the
// clinic id are bound into the UPDATE … WHERE.

const h = vi.hoisted(() => ({
  embedText: vi.fn(),
  sqlCall: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/llm', () => ({
  embedText: h.embedText,
  embed: ({ text }: { text: string }) => h.embedText(text),
}))

vi.mock('@docmee/db', () => {
  // A minimal postgres-style tagged-template client: callable, with .json and .end.
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?')
    h.sqlCall(text, values)
    if (text.includes('SELECT id, content FROM knowledge_chunks')) {
      return Promise.resolve([{ id: 'chunk-1', content: 'current text' }])
    }
    return Promise.resolve([])
  }) as unknown as { json: (v: unknown) => unknown; end: () => void }
  sql.json = (v: unknown) => ({ __json: v })
  sql.end = h.end
  return {
    createServiceDbClient: () => sql,
    toJson: (v: unknown) => v,
  }
})

import { processKbEmbedJob } from '../kb-embed.worker.js'

const CLINIC = 'clinic-A'
const CHUNK = 'chunk-1'

const makeJob = (data: unknown, name = 'embed') => ({ data, name }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.embedText.mockResolvedValue([0.1, 0.2, 0.3])
})

describe('processKbEmbedJob — per-clinic isolation (Req 7)', () => {
  it('embeds the chunk content and scopes the UPDATE to its clinic', async () => {
    await processKbEmbedJob(makeJob({ chunkId: CHUNK, clinicId: CLINIC, content: 'Lun-Vie 9-17' }))

    expect(h.embedText).toHaveBeenCalledWith('Lun-Vie 9-17')

    const [sqlText, values] = h.sqlCall.mock.calls.find(([text]) => String(text).includes('UPDATE knowledge_chunks'))!
    // The WHERE clause must constrain BOTH id and clinic_id.
    expect(sqlText).toContain('UPDATE knowledge_chunks')
    expect(sqlText).toContain('clinic_id')
    // Bound parameters include the chunk id and the clinic id (isolation key).
    expect(values).toContain(CHUNK)
    expect(values).toContain(CLINIC)

    expect(h.end).toHaveBeenCalledTimes(1)
  })

  it('always releases the connection (sql.end) after embedding', async () => {
    await processKbEmbedJob(makeJob({ chunkId: CHUNK, clinicId: CLINIC, content: 'x' }))
    expect(h.end).toHaveBeenCalledTimes(1)
  })

  it('guards an embedding write with the current document version', async () => {
    await processKbEmbedJob(makeJob({
      chunkId: CHUNK,
      clinicId: CLINIC,
      documentId: 'doc-1',
      documentVersion: 7,
      content: 'current text',
    }))

    const [sqlText, values] = h.sqlCall.mock.calls.find(([text]) => String(text).includes('UPDATE knowledge_chunks'))!
    expect(sqlText).toContain('document_version')
    expect(sqlText).toContain('knowledge_documents')
    expect(values).toContain(7)
    expect(values).toContain('doc-1')
  })

  it('marks the current document index failed when embedding fails so it can be retried', async () => {
    h.embedText.mockRejectedValueOnce(new Error('provider unavailable'))
    await expect(processKbEmbedJob(makeJob({
      clinicId: CLINIC, documentId: 'doc-1', documentVersion: 7,
    }, 'embed-document'))).rejects.toThrow('provider unavailable')

    const failedUpdate = h.sqlCall.mock.calls.find(([text]) =>
      String(text).includes("indexing_status = 'failed'"),
    )
    expect(failedUpdate).toBeTruthy()
    expect(failedUpdate?.[1]).toEqual(expect.arrayContaining([CLINIC, 'doc-1', 7]))
  })

  it('marks ready only for an eligible approved document with at least one current active chunk', async () => {
    await processKbEmbedJob(makeJob({
      clinicId: CLINIC, documentId: 'doc-1', documentVersion: 7,
    }, 'embed-document'))

    const readyUpdate = h.sqlCall.mock.calls.find(([text]) => String(text).includes("indexing_status = 'ready'"))
    expect(readyUpdate?.[0]).toContain("d.status = 'active'")
    expect(readyUpdate?.[0]).toContain('d.approved_at IS NOT NULL')
    expect(readyUpdate?.[0]).toContain('EXISTS')
    expect(readyUpdate?.[0]).toContain('c.is_active = true')
  })

  it('keeps absent embedding metadata and mixed chunks unready while allowing fully embedded chunks', async () => {
    await processKbEmbedJob(makeJob({
      clinicId: CLINIC, documentId: 'doc-1', documentVersion: 7,
    }, 'embed-document'))

    const readySql = String(h.sqlCall.mock.calls.find(([text]) =>
      String(text).includes("indexing_status = 'ready'"),
    )?.[0])
    // Missing metadata (`{}` or SQL NULL) must satisfy the missing-chunk branch.
    expect(readySql).toMatch(
      /c\.embedding IS NULL\s+AND NOT COALESCE\(\(c\.metadata -> 'embedding'\) \? 'v', false\)/,
    )
    // NOT EXISTS keeps a mixed set unready; only a fully embedded set clears it.
    expect(readySql).toContain('AND NOT EXISTS')
  })
})
