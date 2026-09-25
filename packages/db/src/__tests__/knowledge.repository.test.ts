import { describe, it, expect } from 'vitest'
import { createKnowledgeRepository } from '../repositories/knowledge.repository.js'
import type { Sql } from '../client.js'
import type { KnowledgeSearchRow } from '../repositories/knowledge.repository.js'

// Tagged-template stand-in for postgres.js. Captures the interpolated values of the
// last query and returns canned rows, so the per-doctor FAQ wiring (Req 30) — the
// metadata folding on create and the doctorId column on listEmbeddedChunks — is
// asserted without a live database. `.json` mirrors postgres.js sql.json: it tags a
// value so the test can read back what was passed.
function fakeSql(
  responseFor?: (query: string, values: unknown[]) => unknown[] | undefined,
): { sql: Sql; lastQuery: () => string; lastValues: () => unknown[]; queries: () => string[]; queryValues: () => unknown[][] } {
  let query = ''
  let values: unknown[] = []
  const allQueries: string[] = []
  const allValues: unknown[][] = []
  const fn = ((strings: TemplateStringsArray, ...vals: unknown[]) => {
    query = strings.join(' ')
    values = vals
    allQueries.push(query)
    allValues.push(vals)
    const response = responseFor?.(query, vals)
    if (response !== undefined) return Promise.resolve(response)
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
    const { sql, queries, queryValues } = fakeSql()
    await createKnowledgeRepository(sql).createDocument({
      clinicId: 'clinic-1',
      title: 'FAQ',
      content: 'body',
      doctorId: 'doc-1',
    })
    // The metadata param is the last interpolated value (sql.json wraps it as __json).
    const metaParam = queryValues()[queries().findIndex(q => q.includes('INSERT INTO knowledge_documents'))]!.at(-1) as { __json: Record<string, unknown> }
    expect(metaParam.__json).toEqual({ doctorId: 'doc-1' })
  })

  it('stores no doctorId for a clinic-wide document', async () => {
    const { sql, queries, queryValues } = fakeSql()
    await createKnowledgeRepository(sql).createDocument({
      clinicId: 'clinic-1',
      title: 'FAQ',
      content: 'body',
    })
    const metaParam = queryValues()[queries().findIndex(q => q.includes('INSERT INTO knowledge_documents'))]!.at(-1) as { __json: Record<string, unknown> }
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
  it.each(['write', 'reindex', 'replaceSource', 'status', 'approveDrafts', 'doctor', 'update', 'delete', 'replaceChunks', 'createDocument', 'createChunk', 'governance'])('takes the shared clinic/revision locks before %s touches any documents or chunks', async operation => {
    const f = fakeSql(q => /FROM knowledge_documents|UPDATE knowledge_documents/.test(q) ? [{ id: 'doc-x', version: 1, content: 'Fact', status: 'active', metadata: {} }] : undefined)
    const repo = createKnowledgeRepository(f.sql)
    if (operation === 'write') await repo.writeDocument({ clinicId: 'clinic', id: 'doc-x', title: 'Title', content: 'Fact', chunks: [] })
    if (operation === 'reindex') await repo.prepareClinicReindex('clinic')
    if (operation === 'replaceSource') await repo.replaceSourceDocuments({ clinicId: 'clinic', source: 'github', documents: [] })
    if (operation === 'status') await repo.updateDocumentStatus('clinic', 'doc-x', 'archived')
    if (operation === 'approveDrafts') await repo.approveDraftDocuments('clinic')
    if (operation === 'doctor') await repo.setDocumentDoctor('clinic', 'doc-x', null)
    if (operation === 'update') await repo.updateDocument('clinic', 'doc-x', { title: 'Title' })
    if (operation === 'delete') await repo.deleteDocument('clinic', 'doc-x')
    if (operation === 'replaceChunks') await repo.replaceChunks('clinic', 'doc-x', [])
    if (operation === 'createDocument') await repo.createDocument({ clinicId: 'clinic', title: 'Title', content: 'Fact' })
    if (operation === 'createChunk') await repo.createChunk({ clinicId: 'clinic', documentId: 'doc-x', content: 'Fact', chunkIndex: 0 })
    if (operation === 'governance') await repo.updateDocumentGovernance('clinic', 'doc-x', { governanceReviewState: 'excluded', governanceNotes: 'Review' })
    expect(f.queries()[0]).toMatch(/FROM clinics[\s\S]*FOR UPDATE/)
    expect(f.queries()[1]).toMatch(/knowledge_retrieval_revisions[\s\S]*FOR UPDATE/)
    if (['createDocument', 'createChunk', 'replaceChunks'].includes(operation)) {
      expect(f.queries().filter(q => q.includes('INSERT INTO knowledge_retrieval_revisions'))).toHaveLength(1)
    }
    const firstDocument = f.queries().findIndex(q => /knowledge_documents|knowledge_chunks/.test(q))
    expect(firstDocument).toBeGreaterThan(1)
  })
  it('governance merges metadata, only archives exclusion states and bumps the retrieval revision once', async () => {
    const f = fakeSql()
    await createKnowledgeRepository(f.sql).updateDocumentGovernance('clinic', 'doc-x', { governanceReviewState: 'trusted', governanceNotes: 'Reviewed' })
    const update = f.queries().find(q => q.includes('UPDATE knowledge_documents'))!
    expect(update).toContain('metadata = metadata ||')
    expect(update).toContain("IN ('excluded', 'archived') THEN 'archived' ELSE status")
    expect(f.queries().filter(q => q.includes('INSERT INTO knowledge_retrieval_revisions'))).toHaveLength(1)
  })
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
    expect(queries().filter((query) => query.includes('INSERT INTO knowledge_retrieval_revisions'))).toHaveLength(1)
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

  it('rebuilds current chunks from authoritative document text without surfacing legacy text', async () => {
    const chunkState: Array<KnowledgeSearchRow & { isActive: boolean }> = [{
      chunkId: 'legacy-v1', documentId: 'doc-v2', title: 'Policy', content: 'legacy v1 old text',
      doctorId: null, language: 'en', documentVersion: 1, updatedAt: '2026-09-19T00:00:00.000Z',
      vectorScore: 0, lexicalScore: 0, source: 'migration', provenance: {},
      effectiveFrom: '2026-09-19T00:00:00.000Z', effectiveUntil: null, retrievalRevision: 0,
      isActive: true,
    }]
    const { sql, queries, queryValues } = fakeSql((query) => {
      if (query.includes('SELECT id, version, content') && query.includes('FROM knowledge_documents')) {
        return [{ id: 'doc-v2', version: 2, content: 'current v2 policy text' }]
      }
      if (query.includes('UPDATE knowledge_chunks') && query.includes('is_active = false')) {
        for (const chunk of chunkState) chunk.isActive = false
        return []
      }
      if (query.includes('INSERT INTO knowledge_chunks')) {
        chunkState.push({
          chunkId: 'chunk-v2', documentId: 'doc-v2', title: 'Policy', content: 'current v2 policy text',
          doctorId: null, language: 'en', documentVersion: 2, updatedAt: '2026-09-20T00:00:00.000Z',
          vectorScore: 0, lexicalScore: 1, source: 'authoritative', provenance: {},
          effectiveFrom: '2026-09-20T00:00:00.000Z', effectiveUntil: null, retrievalRevision: 1,
          isActive: true,
        })
        return [{ id: 'chunk-v2', documentId: 'doc-v2', documentVersion: 2, content: 'current v2 policy text' }]
      }
      if (query.includes('FROM knowledge_chunks')) {
        return chunkState.filter((chunk) => chunk.isActive && chunk.documentVersion === 2)
      }
      return undefined
    })

    const repository = createKnowledgeRepository(sql)
    const queued = await repository.prepareClinicReindex('clinic-1')
    const retrieved = await repository.searchChunks('policy', [], { clinicId: 'clinic-1' })

    const withdrawIndex = queries().findIndex((query) =>
      query.includes('UPDATE knowledge_chunks') && query.includes('is_active = false'),
    )
    const insertIndex = queries().findIndex((query) => query.includes('INSERT INTO knowledge_chunks'))
    expect(withdrawIndex).toBeGreaterThanOrEqual(0)
    expect(insertIndex).toBeGreaterThan(withdrawIndex)
    expect(queryValues()[insertIndex]).toEqual(expect.arrayContaining([
      'doc-v2', 'clinic-1', 'current v2 policy text', 0, 2, true,
    ]))
    expect(queryValues().flat()).not.toContain('legacy v1 old text')
    expect(queued).toEqual([{ id: 'doc-v2', version: 2 }])
    expect(retrieved.map((chunk) => chunk.content)).toEqual(['current v2 policy text'])
    expect(chunkState.find((chunk) => chunk.chunkId === 'legacy-v1')?.isActive).toBe(false)
  })

  it('marks an authoritative document with no indexable current content failed instead of queueing it', async () => {
    const { sql, queries, queryValues } = fakeSql((query) => {
      if (query.includes('SELECT id, version, content') && query.includes('FROM knowledge_documents')) {
        return [{ id: 'doc-empty', version: 3, content: '   ' }]
      }
      return undefined
    })

    const queued = await createKnowledgeRepository(sql).prepareClinicReindex('clinic-1')

    const failedIndex = queries().findIndex((query) =>
      query.includes('UPDATE knowledge_documents') && query.includes("indexing_status = 'failed'"),
    )
    expect(queued).toEqual([])
    expect(failedIndex).toBeGreaterThanOrEqual(0)
    expect(queryValues()[failedIndex]).toEqual(expect.arrayContaining([
      'no_indexable_content', 'clinic-1', 'doc-empty', 3,
    ]))
    expect(queries().some((query) => query.includes('INSERT INTO knowledge_chunks'))).toBe(false)
  })

  it('activation replaces a withdrawn migration chunk with authoritative current content', async () => {
    const chunks = [{ documentId: 'doc-v1', version: 1, content: 'legacy old text', active: false }]
    const { sql } = fakeSql((query, values) => {
      if (query.includes('UPDATE knowledge_documents SET status')) {
        return [{ id: 'doc-v1', version: 1, content: 'authoritative current text', status: 'active', metadata: {} }]
      }
      if (query.includes('UPDATE knowledge_chunks') && query.includes('is_active = false')) {
        for (const chunk of chunks) if (chunk.documentId === 'doc-v1') chunk.active = false
        return []
      }
      if (query.includes('UPDATE knowledge_chunks SET is_active = ')) {
        for (const chunk of chunks) if (chunk.documentId === 'doc-v1' && chunk.version === 1) chunk.active = true
        return []
      }
      if (query.includes('DELETE FROM knowledge_chunks')) {
        chunks.splice(0, chunks.length, ...chunks.filter((chunk) =>
          !(chunk.documentId === 'doc-v1' && chunk.version === 1),
        ))
        return []
      }
      if (query.includes('INSERT INTO knowledge_chunks')) {
        chunks.push({
          documentId: String(values[0]), version: Number(values[5]),
          content: String(values[2]), active: Boolean(values[6]),
        })
        return []
      }
      return undefined
    })

    await createKnowledgeRepository(sql).updateDocumentStatus('clinic-1', 'doc-v1', 'active')

    expect(chunks.filter((chunk) => chunk.active).map((chunk) => chunk.content))
      .toEqual(['authoritative current text'])
  })

  it('approve-all rebuilds only returned drafts and cannot revive an unrelated active legacy chunk', async () => {
    const chunks = [
      { documentId: 'draft-1', version: 1, content: 'draft legacy text', active: false },
      { documentId: 'active-1', version: 1, content: 'unrelated legacy old text', active: false },
    ]
    const { sql } = fakeSql((query, values) => {
      if (query.includes('UPDATE knowledge_documents') && query.includes("status = 'active'")) {
        return [{ id: 'draft-1', version: 1, content: 'approved authoritative text', status: 'active', metadata: {} }]
      }
      if (query.includes('UPDATE knowledge_chunks c SET is_active = true')) {
        for (const chunk of chunks) chunk.active = true
        return []
      }
      if (query.includes('UPDATE knowledge_chunks') && query.includes('is_active = false')) {
        for (const chunk of chunks) if (chunk.documentId === String(values[1])) chunk.active = false
        return []
      }
      if (query.includes('DELETE FROM knowledge_chunks')) {
        const documentId = String(values[1])
        const version = Number(values[2])
        chunks.splice(0, chunks.length, ...chunks.filter((chunk) =>
          !(chunk.documentId === documentId && chunk.version === version),
        ))
        return []
      }
      if (query.includes('INSERT INTO knowledge_chunks')) {
        chunks.push({
          documentId: String(values[0]), version: Number(values[5]),
          content: String(values[2]), active: Boolean(values[6]),
        })
        return []
      }
      return undefined
    })

    const approved = await createKnowledgeRepository(sql).approveDraftDocuments('clinic-1')

    expect(approved.map((document) => document.id)).toEqual(['draft-1'])
    expect(chunks.filter((chunk) => chunk.active).map((chunk) => chunk.content))
      .toEqual(['approved authoritative text'])
    expect(chunks.find((chunk) => chunk.documentId === 'active-1')?.active).toBe(false)
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

  it('keeps a relevant cross-language answer ahead of more than the result limit of irrelevant preferred rows', async () => {
    const irrelevantPreferred = Array.from({ length: 41 }, (_, index) => ({
      chunkId: `en-${index}`, documentId: `en-doc-${index}`, title: `English ${index}`,
      content: 'irrelevant', doctorId: null, language: 'en', documentVersion: 1,
      updatedAt: '2026-09-20T00:00:00.000Z', vectorScore: 0, lexicalScore: 0,
      relevanceScore: 0, languagePreference: 1,
    }))
    const relevantCrossLanguage = {
      chunkId: 'es-relevant', documentId: 'es-doc', title: 'Respuesta',
      content: 'the relevant answer', doctorId: null, language: 'es', documentVersion: 1,
      updatedAt: '2026-09-20T00:00:00.000Z', vectorScore: 0, lexicalScore: 1,
      relevanceScore: 0.25, languagePreference: 0,
    }
    const { sql } = fakeSql((query) => query.includes('FROM knowledge_chunks')
      ? [...irrelevantPreferred, relevantCrossLanguage]
      : undefined)

    const rows = await createKnowledgeRepository(sql).searchChunks(
      'relevant answer', [], { clinicId: 'clinic-1', language: 'en' }, 40,
    ) as Array<KnowledgeSearchRow & { relevanceScore?: number; languagePreference?: number }>

    expect(rows).toHaveLength(40)
    expect(rows[0]?.chunkId).toBe('es-relevant')
  })

  it('normalizes bigint retrieval revisions returned by postgres before validation', async () => {
    const row = {
      chunkId: 'chunk-1', documentId: 'doc-1', title: 'Clinic contact',
      content: 'Call 555-0100.', doctorId: null, language: null, documentVersion: 1,
      updatedAt: '2026-09-25T00:00:00.000Z', vectorScore: 0, lexicalScore: 1,
      relevanceScore: 0.25, languagePreference: 0,
      retrievalRevision: '50' as unknown as number,
    }
    const { sql } = fakeSql((query) => query.includes('FROM knowledge_chunks') ? [row] : undefined)

    const [result] = await createKnowledgeRepository(sql).searchChunks(
      'clinic contact', [], { clinicId: 'clinic-1' }, 5,
    )

    expect(result?.retrievalRevision).toBe(50)
    expect(typeof result?.retrievalRevision).toBe('number')
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
