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

vi.mock('@docmee/llm', () => ({ embedText: h.embedText }))

vi.mock('@docmee/db', () => {
  // A minimal postgres-style tagged-template client: callable, with .json and .end.
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    h.sqlCall(strings.join('?'), values)
    return Promise.resolve()
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

const makeJob = (data: unknown) => ({ data }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.embedText.mockResolvedValue([0.1, 0.2, 0.3])
})

describe('processKbEmbedJob — per-clinic isolation (Req 7)', () => {
  it('embeds the chunk content and scopes the UPDATE to its clinic', async () => {
    await processKbEmbedJob(makeJob({ chunkId: CHUNK, clinicId: CLINIC, content: 'Lun-Vie 9-17' }))

    expect(h.embedText).toHaveBeenCalledWith('Lun-Vie 9-17')

    const [sqlText, values] = h.sqlCall.mock.calls[0]
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
})
