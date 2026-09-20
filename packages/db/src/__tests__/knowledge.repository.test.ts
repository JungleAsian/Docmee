import { describe, it, expect } from 'vitest'
import { createKnowledgeRepository } from '../repositories/knowledge.repository.js'
import type { Sql } from '../client.js'

// Tagged-template stand-in for postgres.js. Captures the interpolated values of the
// last query and returns canned rows, so the per-doctor FAQ wiring (Req 30) — the
// metadata folding on create and the doctorId column on listEmbeddedChunks — is
// asserted without a live database. `.json` mirrors postgres.js sql.json: it tags a
// value so the test can read back what was passed.
function fakeSql(): { sql: Sql; lastQuery: () => string; lastValues: () => unknown[]; queries: () => string[]; queryValues: () => unknown[][] } {
  let query = ''
  let values: unknown[] = []
  const allQueries: string[] = []
  const allValues: unknown[][] = []
  const fn = ((strings: TemplateStringsArray, ...vals: unknown[]) => {
    query = strings.join(' ')
    values = vals
    allQueries.push(query)
    allValues.push(vals)
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
  return { sql: fn, lastQuery: () => query, lastValues: () => values, queries: () => allQueries, queryValues: () => allValues }
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
  it('legacy embedded and lexical reads exclude doctor scope unless that doctor is selected', async () => {
    const { sql, queries, queryValues } = fakeSql()
    const repo = createKnowledgeRepository(sql)

    await repo.listEmbeddedChunks('clinic-1', null)
    await repo.listActiveChunks('clinic-1', 'doctor-1')

    const scopedQueries = queries().filter((query) => query.includes("metadata ->> 'doctorId'"))
    expect(scopedQueries).toHaveLength(2)
    expect(scopedQueries.every((query) => query.includes("IS NULL") && query.includes("= "))).toBe(true)
    expect(queryValues().flat()).toEqual(expect.arrayContaining(['clinic-1', null, 'doctor-1']))
  })

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

  it('invalidates the clinic retrieval revision when title or document type changes', async () => {
    const { sql, queries } = fakeSql()
    await createKnowledgeRepository(sql).updateDocument('clinic-1', 'doc-x', { title: 'Renamed' })

    expect(queries().some((query) => query.includes('knowledge_retrieval_revisions'))).toBe(true)
  })

  it('stores non-active document chunks withdrawn rather than retrievable or pending', async () => {
    const { sql, queries, queryValues } = fakeSql()
    await createKnowledgeRepository(sql).writeDocument({
      clinicId: 'clinic-1', title: 'Old', content: 'old', status: 'archived',
      chunks: [{ content: 'old', chunkIndex: 0 }],
    })

    const documentInsert = queries().findIndex((query) => query.includes('INSERT INTO knowledge_documents'))
    const chunkInsert = queries().findIndex((query) => query.includes('INSERT INTO knowledge_chunks'))
    expect(queryValues()[documentInsert]).toContain('withdrawn')
    expect(queryValues()[chunkInsert]).toContain(false)
  })

  it('replaces a source and bumps one clinic revision in the same transaction', async () => {
    const { sql, queries } = fakeSql()
    const repo = createKnowledgeRepository(sql) as unknown as {
      replaceSourceDocuments: (input: Record<string, unknown>) => Promise<unknown>
    }
    await repo.replaceSourceDocuments({
      clinicId: 'clinic-1', source: 'github', documents: [{
        title: 'Policy', content: 'Current', status: 'active',
        metadata: { path: 'policy.md' }, chunks: [{ content: 'Current', chunkIndex: 0 }],
      }],
    })

    expect(queries().some((query) => query.includes('DELETE FROM knowledge_documents'))).toBe(true)
    expect(queries().filter((query) => query.includes('knowledge_retrieval_revisions'))).toHaveLength(1)
    expect(queries().some((query) => query.includes('INSERT INTO knowledge_chunks'))).toBe(true)
  })

  it('serializes even the first empty source replacement on the stable clinic row', async () => {
    const { sql, queries } = fakeSql()
    await createKnowledgeRepository(sql).replaceSourceDocuments({
      clinicId: 'clinic-1', source: 'github', documents: [],
    })

    const clinicLock = queries().findIndex((query) =>
      query.includes('FROM clinics') && query.includes('FOR UPDATE'),
    )
    const sourceRead = queries().findIndex((query) =>
      query.includes('FROM knowledge_documents') && query.includes('FOR UPDATE'),
    )
    const sourceDelete = queries().findIndex((query) => query.includes('DELETE FROM knowledge_documents'))
    expect(clinicLock).toBeGreaterThanOrEqual(0)
    expect(sourceRead).toBeGreaterThan(clinicLock)
    expect(sourceDelete).toBeGreaterThan(sourceRead)
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
    const { sql, queries, queryValues } = fakeSql()
    const doc = await createKnowledgeRepository(sql).updateDocument('clinic-1', 'doc-x', {
      title: 'New title',
      content: 'New body',
      documentType: 'policy',
    })
    const updateIndex = queries().findIndex((query) => query.includes('UPDATE knowledge_documents'))
    expect(updateIndex).toBeGreaterThanOrEqual(0)
    expect(queryValues()[updateIndex]).toEqual(expect.arrayContaining(['New title', 'New body', 'policy', 'clinic-1', 'doc-x']))
    expect(doc.id).toBe('doc-x')
  })
})
