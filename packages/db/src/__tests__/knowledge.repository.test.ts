import { describe, it, expect } from 'vitest'
import { createKnowledgeRepository } from '../repositories/knowledge.repository.js'
import type { Sql } from '../client.js'

// Tagged-template stand-in for postgres.js. Captures the interpolated values of the
// last query and returns canned rows, so the per-doctor FAQ wiring (Req 30) — the
// metadata folding on create and the doctorId column on listEmbeddedChunks — is
// asserted without a live database. `.json` mirrors postgres.js sql.json: it tags a
// value so the test can read back what was passed.
function fakeSql(): { sql: Sql; lastQuery: () => string; lastValues: () => unknown[]; queries: () => string[] } {
  let query = ''
  let values: unknown[] = []
  const allQueries: string[] = []
  const fn = ((strings: TemplateStringsArray, ...vals: unknown[]) => {
    query = strings.join(' ')
    values = vals
    allQueries.push(query)
    if (query.includes('FROM knowledge_chunks')) {
      return Promise.resolve([
        { title: 'Horarios', content: 'L-V 9-18', embedding: [0.1], doctorId: null },
        { title: 'García video', content: 'sí', embedding: [0.2], doctorId: 'doc-1' },
      ])
    }
    return Promise.resolve([{ id: 'doc-x', metadata: {} }])
  }) as unknown as Sql
  ;(fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => ({ __json: v })
  ;(fn as unknown as { begin: (cb: (tx: Sql) => unknown) => unknown }).begin = (cb) => cb(fn)
  return { sql: fn, lastQuery: () => query, lastValues: () => values, queries: () => allQueries }
}

describe('knowledge.repository — per-doctor FAQ scope (Req 30)', () => {
  it('folds doctorId into document metadata on create', async () => {
    const { sql, lastValues } = fakeSql()
    await createKnowledgeRepository(sql).createDocument({
      clinicId: 'clinic-1',
      title: 'FAQ',
      content: 'body',
      doctorId: 'doc-1',
    })
    // The metadata param is the last interpolated value (sql.json wraps it as __json).
    const metaParam = lastValues().at(-1) as { __json: Record<string, unknown> }
    expect(metaParam.__json).toEqual({ doctorId: 'doc-1' })
  })

  it('stores no doctorId for a clinic-wide document', async () => {
    const { sql, lastValues } = fakeSql()
    await createKnowledgeRepository(sql).createDocument({
      clinicId: 'clinic-1',
      title: 'FAQ',
      content: 'body',
    })
    const metaParam = lastValues().at(-1) as { __json: Record<string, unknown> }
    expect(metaParam.__json).toEqual({})
  })

  it('listEmbeddedChunks selects the document doctorId and passes it through', async () => {
    const { sql, lastQuery } = fakeSql()
    const chunks = await createKnowledgeRepository(sql).listEmbeddedChunks('clinic-1')
    expect(lastQuery()).toContain("d.metadata ->> 'doctorId'")
    expect(chunks.map((c) => c.doctorId)).toEqual([null, 'doc-1'])
  })
})

describe('knowledge.repository — freshness retrieval contract', () => {
  it('invalidates the clinic retrieval revision when doctor scope changes', async () => {
    const { sql, queries } = fakeSql()
    await createKnowledgeRepository(sql).setDocumentDoctor('clinic-1', 'doc-x', 'doctor-1')

    expect(queries().some((query) => query.includes('knowledge_retrieval_revisions'))).toBe(true)
  })

  it('invalidates the clinic retrieval revision when a document is deleted', async () => {
    const { sql, queries } = fakeSql()
    await createKnowledgeRepository(sql).deleteDocument('clinic-1', 'doc-x')

    expect(queries().some((query) => query.includes('knowledge_retrieval_revisions'))).toBe(true)
  })

  it('runs lexical retrieval when no vector is available', async () => {
    const { sql, lastQuery, lastValues } = fakeSql()
    await createKnowledgeRepository(sql).searchChunks('horario sábado', [], { clinicId: 'clinic-1' })

    expect(lastQuery()).toContain('websearch_to_tsquery')
    expect(lastValues()).toContain('clinic-1')
  })

  it('only retrieves current approved effective chunks and excludes doctor scope without a doctor', async () => {
    const { sql, lastQuery } = fakeSql()
    await createKnowledgeRepository(sql).searchChunks('horario', [], { clinicId: 'clinic-1' })
    const query = lastQuery()

    expect(query).toContain('c.document_version = d.version')
    expect(query).toContain('c.is_active = true')
    expect(query).toContain('d.approved_at IS NOT NULL')
    expect(query).toContain("d.metadata ->> 'doctorId' IS NULL")
    expect(query).toContain('effective_from')
    expect(query).toContain('effective_until')
  })

  it('prefers the requested language without filtering out the only valid answer', async () => {
    const { sql, lastQuery } = fakeSql()
    await createKnowledgeRepository(sql).searchChunks('hours', [], { clinicId: 'clinic-1', language: 'en' })
    const query = lastQuery()

    expect(query).toContain('language_preference')
    expect(query).not.toContain("AND ( IS NULL OR lower(COALESCE(d.metadata ->> 'language'")
  })
})

describe('knowledge.repository — Screen 7 (training state + entry editor)', () => {
  it('documentTrainingStats counts chunks and embedded chunks per document', async () => {
    const { sql, lastQuery, lastValues } = fakeSql()
    await createKnowledgeRepository(sql).documentTrainingStats('clinic-1')
    const q = lastQuery()
    expect(q).toContain('GROUP BY c.document_id')
    expect(q).toContain("(c.metadata -> 'embedding') ? 'v'")
    expect(lastValues()).toContain('clinic-1')
  })

  it('updateDocument COALESCEs each editable field and returns the row', async () => {
    const { sql, lastQuery, lastValues } = fakeSql()
    const doc = await createKnowledgeRepository(sql).updateDocument('clinic-1', 'doc-x', {
      title: 'New title',
      content: 'New body',
      documentType: 'policy',
    })
    expect(lastQuery()).toContain('UPDATE knowledge_documents')
    expect(lastValues()).toEqual(expect.arrayContaining(['New title', 'New body', 'policy', 'clinic-1', 'doc-x']))
    expect(doc.id).toBe('doc-x')
  })
})
