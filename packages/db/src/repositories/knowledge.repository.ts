import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import type {
  KnowledgeDocument,
  KnowledgeChunk,
  IaProfile,
  IaRule,
  IaRuleType,
  DocumentType,
  DocumentStatus,
} from '../types/index.js'

export interface CreateDocumentInput {
  clinicId: string
  title: string
  content: string
  documentType?: DocumentType
  status?: DocumentStatus
  /** Scope this document to a single doctor (Req 30 per-doctor FAQs); stored in
   *  metadata.doctorId. Omit/null for a clinic-wide document. */
  doctorId?: string | null
  metadata?: Record<string, unknown>
}

export interface CreateChunkInput {
  documentId: string
  clinicId: string
  content: string
  chunkIndex: number
  metadata?: Record<string, unknown>
}

export interface WriteDocumentInput extends CreateDocumentInput {
  id?: string
  chunks: Array<Omit<CreateChunkInput, 'documentId' | 'clinicId'>>
}

export interface DocumentIndexWrite {
  document: KnowledgeDocument
  chunks: KnowledgeChunk[]
  retrievalRevision: number
}

export interface ReplaceSourceDocumentsInput {
  clinicId: string
  source: string
  documents: Array<Omit<WriteDocumentInput, 'clinicId' | 'id'>>
}

/** A KB chunk paired with its stored embedding, for in-process similarity search. */
export interface EmbeddedChunkRow {
  title: string
  content: string
  embedding: number[]
  /** Owning document's doctor scope (Req 30); null for a clinic-wide document. */
  doctorId: string | null
}

/** Active KB chunk without requiring an embedding, used as a safe retrieval
 * fallback when the embedding provider is not configured or indexing is pending. */
export interface ActiveChunkRow {
  title: string
  content: string
  /** Owning document's doctor scope (Req 30); null for a clinic-wide document. */
  doctorId: string | null
}

export interface KnowledgeSearchFilters {
  clinicId: string
  language?: string
  doctorId?: string
  documentVersion?: number
}

export interface KnowledgeSearchRow {
  chunkId: string
  documentId: string
  title: string
  content: string
  doctorId: string | null
  language: string | null
  documentVersion: number
  updatedAt: string
  vectorScore: number
  lexicalScore: number
  source?: string | null
  provenance?: Record<string, unknown>
  effectiveFrom?: string
  effectiveUntil?: string | null
  retrievalRevision?: number
}

export type KnowledgeCandidateStatus = 'pending_review' | 'approved' | 'rejected' | 'superseded'
export interface KnowledgeCandidate {
  id: string
  clinicId: string
  retrievalEventId: string | null
  sourceQuestion: string
  candidateContent: string
  status: KnowledgeCandidateStatus
  confidenceScore: number
  groundingScore: number
  medicalSafetyOk: boolean
  promptSafetyOk: boolean
  contradictionFree: boolean
  consistencyCount: number
  patientFeedback: 'accepted' | 'corrected' | 'escalated' | 'unknown'
  humanEdit: string | null
  approvedBy: string | null
  approvedAt: string | null
  sourceDocumentId: string | null
  sourceDocumentVersion: number | null
  previousVersionId: string | null
  supportingChunks: unknown[]
  originalSource: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Per-document training progress (Screen 7): how many chunks exist and how many
 *  already carry an embedding. The bot can only retrieve embedded chunks, so this
 *  drives the panel's "trained / training / not indexed" state. */
export interface DocumentTrainingStat {
  documentId: string
  chunkCount: number
  embeddedCount: number
}

/** Editable fields of an existing KB document (Screen 7 entry editor). */
export interface UpdateDocumentInput {
  title?: string
  content?: string
  documentType?: DocumentType
}

export interface CreateIaProfileInput {
  clinicId: string
  name: string
  systemPrompt?: string
  model?: string
  temperature?: number
  maxTokens?: number
  settings?: Record<string, unknown>
}

export interface UpdateIaProfileInput {
  name?: string
  systemPrompt?: string
  model?: string
  temperature?: number
  maxTokens?: number
  isActive?: boolean
  settings?: Record<string, unknown>
}

export interface CreateIaRuleInput {
  iaProfileId: string
  clinicId: string
  ruleType: IaRuleType
  condition?: Record<string, unknown>
  action?: Record<string, unknown>
  priority?: number
}

export interface KnowledgeRepository {
  listDocuments(clinicId: string): Promise<KnowledgeDocument[]>
  findDocument(clinicId: string, id: string): Promise<KnowledgeDocument | null>
  createDocument(data: CreateDocumentInput): Promise<KnowledgeDocument>
  /** Atomically creates/edits content, withdraws old chunks, installs current
   * lexical chunks, and increments the clinic retrieval revision. */
  writeDocument(data: WriteDocumentInput): Promise<DocumentIndexWrite>
  /** Atomically withdraws every document for one source, installs its complete
   * replacement set, and increments the clinic revision exactly once. */
  replaceSourceDocuments(data: ReplaceSourceDocumentsInput): Promise<DocumentIndexWrite[]>
  getClinicRetrievalRevision(clinicId: string): Promise<number>
  markDocumentIndexFailed(clinicId: string, id: string, version: number, error: string): Promise<void>
  prepareClinicReindex(clinicId: string): Promise<Array<{ id: string; version: number }>>
  /** Edit an existing document's title / content / type (Screen 7 entry editor). */
  updateDocument(clinicId: string, id: string, data: UpdateDocumentInput): Promise<KnowledgeDocument>
  updateDocumentStatus(clinicId: string, id: string, status: DocumentStatus): Promise<KnowledgeDocument>
  approveDraftDocuments(clinicId: string): Promise<KnowledgeDocument[]>
  /** Scope a document to a doctor (Req 30), or pass null to make it clinic-wide. */
  setDocumentDoctor(clinicId: string, id: string, doctorId: string | null): Promise<KnowledgeDocument>
  deleteDocument(clinicId: string, id: string): Promise<void>

  listChunks(clinicId: string, documentId: string): Promise<KnowledgeChunk[]>
  /** Per-document chunk + embedded-chunk counts for the whole clinic (training state). */
  documentTrainingStats(clinicId: string): Promise<DocumentTrainingStat[]>
  /** Chunks of active documents that carry an embedding, for KB retrieval. */
  listEmbeddedChunks(clinicId: string, doctorId?: string | null): Promise<EmbeddedChunkRow[]>
  /** Active chunks regardless of embedding state, for keyword fallback retrieval. */
  listActiveChunks(clinicId: string, doctorId?: string | null): Promise<ActiveChunkRow[]>
  /** Hybrid pgvector + PostgreSQL full-text retrieval; only candidate rows are returned. */
  searchChunks(query: string, embedding: number[], filters: KnowledgeSearchFilters, limit?: number): Promise<KnowledgeSearchRow[]>
  createKnowledgeCandidate(input: {
    clinicId: string
    retrievalEventId?: string | null
    sourceQuestion: string
    candidateContent: string
    confidenceScore: number
    groundingScore: number
    medicalSafetyOk: boolean
    promptSafetyOk: boolean
    contradictionFree: boolean
    consistencyCount?: number
    patientFeedback?: 'accepted' | 'corrected' | 'escalated' | 'unknown'
    supportingChunks: unknown[]
    originalSource?: Record<string, unknown>
  }): Promise<KnowledgeCandidate>
  updateRetrievalFeedback(eventId: string, feedback: 'accepted' | 'corrected' | 'escalated' | 'unknown', humanEdit?: string | null, humanApproved?: boolean): Promise<void>
  recordRetrievalEvent(event: {
    clinicId: string
    conversationId?: string | null
    query: string
    language?: string | null
    filters?: Record<string, unknown>
    selectedChunks: unknown[]
    answer?: string | null
    handoffReason?: string | null
    confidenceScore?: number | null
    patientFeedback?: 'accepted' | 'corrected' | 'escalated' | 'unknown'
    candidateId?: string | null
  }): Promise<string>
  createChunk(data: CreateChunkInput): Promise<KnowledgeChunk>
  replaceChunks(clinicId: string, documentId: string, chunks: Omit<CreateChunkInput, 'documentId' | 'clinicId'>[]): Promise<KnowledgeChunk[]>

  listIaProfiles(clinicId: string): Promise<IaProfile[]>
  findIaProfile(clinicId: string, id: string): Promise<IaProfile | null>
  createIaProfile(data: CreateIaProfileInput): Promise<IaProfile>
  updateIaProfile(clinicId: string, id: string, data: UpdateIaProfileInput): Promise<IaProfile>

  listIaRules(clinicId: string, iaProfileId: string): Promise<IaRule[]>
  createIaRule(data: CreateIaRuleInput): Promise<IaRule>
  deleteIaRule(clinicId: string, id: string): Promise<void>
}

export function createKnowledgeRepository(sql: Sql): KnowledgeRepository {
  return {
    async listDocuments(clinicId) {
      return sql<KnowledgeDocument[]>`
        SELECT * FROM knowledge_documents WHERE clinic_id = ${clinicId} ORDER BY created_at DESC
      `
    },

    async findDocument(clinicId, id) {
      const rows = await sql<KnowledgeDocument[]>`
        SELECT * FROM knowledge_documents WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async createDocument(data) {
      // Per-doctor FAQ scope (Req 30) lives in metadata.doctorId alongside any
      // caller-supplied metadata, so retrieval can filter on it (listEmbeddedChunks).
      const metadata = {
        ...(data.metadata ?? {}),
        ...(data.doctorId ? { doctorId: data.doctorId } : {}),
      }
      const rows = await sql<KnowledgeDocument[]>`
        INSERT INTO knowledge_documents (clinic_id, title, content, document_type, status, approved_at, metadata)
        VALUES (
          ${data.clinicId},
          ${data.title},
          ${data.content},
          ${data.documentType ?? 'faq'},
          ${data.status       ?? 'draft'},
          CASE WHEN ${data.status ?? 'draft'} = 'active' THEN now() ELSE NULL END,
          ${sql.json(toJson(metadata))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async writeDocument(data) {
      return sql.begin(async (tx) => {
        const withDoctorScope = (base: Record<string, unknown>) => {
          const metadata = { ...base }
          if (data.doctorId === null) delete metadata.doctorId
          else if (data.doctorId !== undefined) metadata.doctorId = data.doctorId
          return metadata
        }
        let document: KnowledgeDocument
        let chunksActive: boolean
        if (data.id) {
          const current = await tx<(KnowledgeDocument & { version?: number })[]>`
            SELECT * FROM knowledge_documents
            WHERE clinic_id = ${data.clinicId} AND id = ${data.id}
            FOR UPDATE
          `
          if (!current[0]) throw new Error(`Document not found: ${data.id}`)
          const metadata = withDoctorScope(data.metadata ?? current[0].metadata ?? {})
          const nextVersion = (current[0].version ?? 1) + 1
          const nextStatus = data.status ?? current[0].status
          chunksActive = nextStatus === 'active'
          await tx`
            UPDATE knowledge_chunks
            SET is_active = false, embedding = NULL, embedding_model = NULL,
                embedded_at = NULL, metadata = COALESCE(metadata, '{}') - 'embedding'
            WHERE clinic_id = ${data.clinicId} AND document_id = ${data.id}
          `
          const rows = await tx<KnowledgeDocument[]>`
            UPDATE knowledge_documents SET
              title = ${data.title}, content = ${data.content},
              document_type = ${data.documentType ?? current[0].documentType},
              status = ${nextStatus}, version = ${nextVersion},
              approved_at = CASE WHEN ${nextStatus} = 'active' THEN now() ELSE NULL END,
              indexing_status = ${chunksActive ? 'pending' : 'withdrawn'}, indexing_error = NULL,
              metadata = ${tx.json(toJson(metadata))}
            WHERE clinic_id = ${data.clinicId} AND id = ${data.id}
            RETURNING *
          `
          document = rows[0]!
        } else {
          const metadata = withDoctorScope(data.metadata ?? {})
          const nextStatus = data.status ?? 'draft'
          chunksActive = nextStatus === 'active'
          const rows = await tx<KnowledgeDocument[]>`
            INSERT INTO knowledge_documents
              (clinic_id, title, content, document_type, status, approved_at, indexing_status, metadata)
            VALUES (${data.clinicId}, ${data.title}, ${data.content}, ${data.documentType ?? 'faq'},
              ${nextStatus}, CASE WHEN ${nextStatus} = 'active' THEN now() ELSE NULL END,
              ${chunksActive ? 'pending' : 'withdrawn'}, ${tx.json(toJson(metadata))})
            RETURNING *
          `
          document = rows[0]!
        }
        const version = document.version ?? 1
        const chunks: KnowledgeChunk[] = []
        for (const chunk of data.chunks) {
          const rows = await tx<KnowledgeChunk[]>`
            INSERT INTO knowledge_chunks
              (document_id, clinic_id, content, chunk_index, metadata, document_version, is_active)
            VALUES (${document.id}, ${data.clinicId}, ${chunk.content}, ${chunk.chunkIndex},
              ${tx.json(toJson(chunk.metadata ?? {}))}, ${version}, ${chunksActive})
            RETURNING *
          `
          chunks.push(rows[0]!)
        }
        const revision = await tx<{ revision: number }[]>`
          INSERT INTO knowledge_retrieval_revisions (clinic_id, revision)
          VALUES (${data.clinicId}, 1)
          ON CONFLICT (clinic_id) DO UPDATE
          SET revision = knowledge_retrieval_revisions.revision + 1, updated_at = now()
          RETURNING revision
        `
        return { document, chunks, retrievalRevision: Number(revision[0]?.revision ?? 1) }
      }) as unknown as Promise<DocumentIndexWrite>
    },

    async getClinicRetrievalRevision(clinicId) {
      const rows = await sql<{ revision: number }[]>`
        SELECT revision FROM knowledge_retrieval_revisions WHERE clinic_id = ${clinicId}
      `
      return Number(rows[0]?.revision ?? 0)
    },

    async replaceSourceDocuments(data) {
      return sql.begin(async (tx) => {
        // Source rows may not exist on the first import, so they cannot provide
        // a serialization point. The owning clinic row is stable and makes
        // same-clinic source replacements enter this transaction one at a time.
        await tx`
          SELECT id FROM clinics
          WHERE id = ${data.clinicId}
          FOR UPDATE
        `
        const existing = await tx<Array<{ id: string }>>`
          SELECT id FROM knowledge_documents
          WHERE clinic_id = ${data.clinicId} AND metadata ->> 'source' = ${data.source}
          FOR UPDATE
        `
        const existingIds = existing.map((row) => row.id)
        if (existingIds.length > 0) {
          await tx`DELETE FROM knowledge_chunks WHERE clinic_id = ${data.clinicId} AND document_id = ANY(${existingIds})`
          await tx`DELETE FROM knowledge_documents WHERE clinic_id = ${data.clinicId} AND id = ANY(${existingIds})`
        } else {
          // Keep the replacement query observable even when the source is newly empty.
          await tx`
            DELETE FROM knowledge_documents
            WHERE clinic_id = ${data.clinicId} AND metadata ->> 'source' = ${data.source}
          `
        }

        const writes: Array<{ document: KnowledgeDocument; chunks: KnowledgeChunk[] }> = []
        for (const input of data.documents) {
          const status = input.status ?? 'draft'
          const chunksActive = status === 'active'
          const metadata = { ...(input.metadata ?? {}), source: data.source }
          const documents = await tx<KnowledgeDocument[]>`
            INSERT INTO knowledge_documents
              (clinic_id, title, content, document_type, status, approved_at, indexing_status, metadata)
            VALUES (${data.clinicId}, ${input.title}, ${input.content}, ${input.documentType ?? 'faq'},
              ${status}, CASE WHEN ${status} = 'active' THEN now() ELSE NULL END,
              ${chunksActive ? 'pending' : 'withdrawn'}, ${tx.json(toJson(metadata))})
            RETURNING *
          `
          const document = documents[0]!
          const version = document.version ?? 1
          const chunks: KnowledgeChunk[] = []
          for (const chunk of input.chunks) {
            const rows = await tx<KnowledgeChunk[]>`
              INSERT INTO knowledge_chunks
                (document_id, clinic_id, content, chunk_index, metadata, document_version, is_active)
              VALUES (${document.id}, ${data.clinicId}, ${chunk.content}, ${chunk.chunkIndex},
                ${tx.json(toJson(chunk.metadata ?? {}))}, ${version}, ${chunksActive})
              RETURNING *
            `
            chunks.push(rows[0]!)
          }
          writes.push({ document, chunks })
        }

        const revisions = await tx<Array<{ revision: number }>>`
          INSERT INTO knowledge_retrieval_revisions (clinic_id, revision) VALUES (${data.clinicId}, 1)
          ON CONFLICT (clinic_id) DO UPDATE
          SET revision = knowledge_retrieval_revisions.revision + 1, updated_at = now()
          RETURNING revision
        `
        const retrievalRevision = Number(revisions[0]?.revision ?? 1)
        return writes.map((write) => ({ ...write, retrievalRevision }))
      }) as unknown as Promise<DocumentIndexWrite[]>
    },

    async markDocumentIndexFailed(clinicId, id, version, error) {
      await sql`
        UPDATE knowledge_documents
        SET indexing_status = 'failed', indexing_error = ${error.slice(0, 500)}
        WHERE clinic_id = ${clinicId} AND id = ${id} AND version = ${version}
      `
    },

    async prepareClinicReindex(clinicId) {
      return sql.begin(async (tx) => {
        const docs = await tx<Array<{ id: string; version: number }>>`
          UPDATE knowledge_documents
          SET indexing_status = 'pending', indexing_error = NULL
          WHERE clinic_id = ${clinicId} AND status = 'active' AND approved_at IS NOT NULL
            AND effective_from <= now() AND (effective_until IS NULL OR effective_until > now())
          RETURNING id, version
        `
        await tx`
          UPDATE knowledge_chunks c
          SET embedding = NULL, embedding_model = NULL, embedded_at = NULL,
              metadata = COALESCE(c.metadata, '{}') - 'embedding'
          FROM knowledge_documents d
          WHERE c.clinic_id = ${clinicId} AND d.clinic_id = c.clinic_id AND d.id = c.document_id
            AND c.document_version = d.version AND c.is_active = true
            AND d.status = 'active' AND d.approved_at IS NOT NULL
        `
        await tx`
          INSERT INTO knowledge_retrieval_revisions (clinic_id, revision) VALUES (${clinicId}, 1)
          ON CONFLICT (clinic_id) DO UPDATE
          SET revision = knowledge_retrieval_revisions.revision + 1, updated_at = now()
        `
        return docs
      }) as unknown as Promise<Array<{ id: string; version: number }>>
    },

    async updateDocument(clinicId, id, data) {
      return sql.begin(async (tx) => {
        const rows = await tx<KnowledgeDocument[]>`
          UPDATE knowledge_documents SET
            title         = COALESCE(${data.title        ?? null}, title),
            content       = COALESCE(${data.content      ?? null}, content),
            document_type = COALESCE(${data.documentType ?? null}, document_type)
          WHERE clinic_id = ${clinicId} AND id = ${id}
          RETURNING *
        `
        if (!rows[0]) throw new Error(`Document not found: ${id}`)
        await tx`
          INSERT INTO knowledge_retrieval_revisions (clinic_id, revision) VALUES (${clinicId}, 1)
          ON CONFLICT (clinic_id) DO UPDATE
          SET revision = knowledge_retrieval_revisions.revision + 1, updated_at = now()
        `
        return rows[0]
      }) as unknown as Promise<KnowledgeDocument>
    },

    async updateDocumentStatus(clinicId, id, status) {
      return sql.begin(async (tx) => {
        const rows = await tx<KnowledgeDocument[]>`
          UPDATE knowledge_documents SET status = ${status},
            approved_at = CASE WHEN ${status} = 'active' THEN now() ELSE approved_at END,
            indexing_status = CASE WHEN ${status} = 'active' THEN 'pending' ELSE 'withdrawn' END,
            indexing_error = NULL
          WHERE clinic_id = ${clinicId} AND id = ${id}
          RETURNING *
        `
        if (!rows[0]) throw new Error(`Document not found: ${id}`)
        await tx`
          UPDATE knowledge_chunks SET is_active = ${status === 'active'}
          WHERE clinic_id = ${clinicId} AND document_id = ${id}
            AND document_version = ${rows[0].version ?? 1}
        `
        await tx`
          INSERT INTO knowledge_retrieval_revisions (clinic_id, revision) VALUES (${clinicId}, 1)
          ON CONFLICT (clinic_id) DO UPDATE
          SET revision = knowledge_retrieval_revisions.revision + 1, updated_at = now()
        `
        return rows[0]
      }) as unknown as Promise<KnowledgeDocument>
    },

    async approveDraftDocuments(clinicId) {
      return sql.begin(async (tx) => {
        const docs = await tx<KnowledgeDocument[]>`
          UPDATE knowledge_documents
          SET status = 'active', approved_at = now(), indexing_status = 'pending', indexing_error = NULL
          WHERE clinic_id = ${clinicId} AND status = 'draft'
          RETURNING *
        `
        if (docs.length > 0) {
          await tx`
            UPDATE knowledge_chunks c SET is_active = true
            FROM knowledge_documents d
            WHERE c.clinic_id = ${clinicId} AND d.id = c.document_id AND d.clinic_id = c.clinic_id
              AND c.document_version = d.version AND d.status = 'active'
          `
          await tx`
            INSERT INTO knowledge_retrieval_revisions (clinic_id, revision) VALUES (${clinicId}, 1)
            ON CONFLICT (clinic_id) DO UPDATE
            SET revision = knowledge_retrieval_revisions.revision + 1, updated_at = now()
          `
        }
        return docs
      }) as unknown as Promise<KnowledgeDocument[]>
    },

    async setDocumentDoctor(clinicId, id, doctorId) {
      return sql.begin(async (tx) => {
        // Merge onto existing metadata so other keys survive; null removes the scope.
        const rows = await tx<KnowledgeDocument[]>`
          UPDATE knowledge_documents
          SET metadata = ${
            doctorId
              ? tx`metadata || ${tx.json(toJson({ doctorId }))}`
              : tx`metadata - 'doctorId'`
          }
          WHERE clinic_id = ${clinicId} AND id = ${id}
          RETURNING *
        `
        if (!rows[0]) throw new Error(`Document not found: ${id}`)
        await tx`
          INSERT INTO knowledge_retrieval_revisions (clinic_id, revision) VALUES (${clinicId}, 1)
          ON CONFLICT (clinic_id) DO UPDATE
          SET revision = knowledge_retrieval_revisions.revision + 1, updated_at = now()
        `
        return rows[0]
      }) as unknown as Promise<KnowledgeDocument>
    },

    async deleteDocument(clinicId, id) {
      await sql.begin(async (tx) => {
        const deleted = await tx<Array<{ id: string }>>`
          DELETE FROM knowledge_documents WHERE clinic_id = ${clinicId} AND id = ${id}
          RETURNING id
        `
        if (deleted.length > 0) {
          await tx`
            INSERT INTO knowledge_retrieval_revisions (clinic_id, revision) VALUES (${clinicId}, 1)
            ON CONFLICT (clinic_id) DO UPDATE
            SET revision = knowledge_retrieval_revisions.revision + 1, updated_at = now()
          `
        }
      })
    },

    async listChunks(clinicId, documentId) {
      return sql<KnowledgeChunk[]>`
        SELECT * FROM knowledge_chunks
        WHERE clinic_id = ${clinicId} AND document_id = ${documentId}
        ORDER BY chunk_index
      `
    },

    async documentTrainingStats(clinicId) {
      // One grouped pass over the clinic's chunks — no per-document round trips.
      return sql<DocumentTrainingStat[]>`
        SELECT c.document_id AS document_id,
               COUNT(*)::int AS chunk_count,
               COUNT(*) FILTER (WHERE c.embedding IS NOT NULL OR (c.metadata -> 'embedding') ? 'v')::int AS embedded_count
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON d.id = c.document_id AND d.clinic_id = c.clinic_id
        WHERE c.clinic_id = ${clinicId} AND c.is_active = true AND c.document_version = d.version
        GROUP BY c.document_id
      `
    },

    async listEmbeddedChunks(clinicId, doctorId = null) {
      return sql<EmbeddedChunkRow[]>`
        SELECT d.title AS title,
               c.content AS content,
               c.metadata -> 'embedding' -> 'v' AS embedding,
               d.metadata ->> 'doctorId' AS doctor_id
        FROM knowledge_chunks c
        JOIN knowledge_documents d
          ON d.id = c.document_id AND d.clinic_id = c.clinic_id
        WHERE c.clinic_id = ${clinicId}
          AND d.status = 'active'
          AND d.approved_at IS NOT NULL
          AND d.effective_from <= now() AND (d.effective_until IS NULL OR d.effective_until > now())
          AND c.is_active = true AND c.document_version = d.version
          AND COALESCE(d.metadata ->> 'governanceReviewState', 'trusted') NOT IN ('excluded', 'archived')
          AND ((${doctorId}::text IS NULL AND d.metadata ->> 'doctorId' IS NULL)
            OR (${doctorId}::text IS NOT NULL AND
              (d.metadata ->> 'doctorId' IS NULL OR d.metadata ->> 'doctorId' = ${doctorId})))
          AND (c.metadata -> 'embedding') ? 'v'
      `
    },

    async listActiveChunks(clinicId, doctorId = null) {
      return sql<ActiveChunkRow[]>`
        SELECT d.title AS title,
               c.content AS content,
               d.metadata ->> 'doctorId' AS doctor_id
        FROM knowledge_chunks c
        JOIN knowledge_documents d
          ON d.id = c.document_id AND d.clinic_id = c.clinic_id
        WHERE c.clinic_id = ${clinicId}
          AND d.status = 'active'
          AND d.approved_at IS NOT NULL
          AND d.effective_from <= now() AND (d.effective_until IS NULL OR d.effective_until > now())
          AND c.is_active = true AND c.document_version = d.version
          AND COALESCE(d.metadata ->> 'governanceReviewState', 'trusted') NOT IN ('excluded', 'archived')
          AND ((${doctorId}::text IS NULL AND d.metadata ->> 'doctorId' IS NULL)
            OR (${doctorId}::text IS NOT NULL AND
              (d.metadata ->> 'doctorId' IS NULL OR d.metadata ->> 'doctorId' = ${doctorId})))
        ORDER BY d.updated_at DESC, c.chunk_index ASC
      `
    },

    async searchChunks(query, embedding, filters, limit = 40) {
      const vector = embedding.length === 1536 ? `[${embedding.join(',')}]` : null
      return sql<KnowledgeSearchRow[]>`
        WITH clinic_revision AS (
          SELECT COALESCE((SELECT revision FROM knowledge_retrieval_revisions WHERE clinic_id = ${filters.clinicId}), 0) AS revision
        )
        SELECT c.id AS chunk_id,
               d.id AS document_id,
               d.title,
               c.content,
               d.metadata ->> 'doctorId' AS doctor_id,
               COALESCE(d.metadata ->> 'language', c.metadata ->> 'language') AS language,
               d.version AS document_version,
               d.updated_at,
               CASE WHEN ${vector}::text IS NULL OR c.embedding IS NULL THEN 0
                    ELSE COALESCE((1 - (c.embedding <=> ${vector}::vector))::float8, 0) END::float8 AS vector_score,
               ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', ${query}))::float8 AS lexical_score,
               d.metadata ->> 'source' AS source, d.metadata AS provenance,
               d.effective_from, d.effective_until, clinic_revision.revision AS retrieval_revision,
               CASE WHEN ${filters.language ?? null}::text IS NOT NULL AND
                 lower(COALESCE(d.metadata ->> 'language', c.metadata ->> 'language', '')) = lower(${filters.language ?? null})
                 THEN 1 ELSE 0 END AS language_preference
        FROM knowledge_chunks c
        JOIN knowledge_documents d ON d.id = c.document_id AND d.clinic_id = c.clinic_id
        CROSS JOIN clinic_revision
        WHERE c.clinic_id = ${filters.clinicId}
          AND d.status = 'active'
          AND d.approved_at IS NOT NULL
          AND d.effective_from <= now() AND (d.effective_until IS NULL OR d.effective_until > now())
          AND c.is_active = true AND c.document_version = d.version
          AND COALESCE(d.metadata ->> 'governanceReviewState', 'trusted') NOT IN ('excluded', 'archived')
          AND ((${filters.doctorId ?? null}::text IS NULL AND d.metadata ->> 'doctorId' IS NULL)
            OR (${filters.doctorId ?? null}::text IS NOT NULL AND
              (d.metadata ->> 'doctorId' IS NULL OR d.metadata ->> 'doctorId' = ${filters.doctorId ?? null})))
          AND (${filters.documentVersion ?? null}::int IS NULL OR d.version = ${filters.documentVersion ?? null})
        ORDER BY language_preference DESC,
                 (0.65 * CASE WHEN ${vector}::text IS NULL OR c.embedding IS NULL THEN 0 ELSE COALESCE((1 - (c.embedding <=> ${vector}::vector)), 0) END +
                  0.25 * LEAST(ts_rank_cd(c.search_vector, websearch_to_tsquery('simple', ${query})), 1) +
                  0.05 * (1.0 / (1.0 + GREATEST(EXTRACT(EPOCH FROM (now() - d.updated_at)) / 86400.0, 0))) +
                  0.05 * LEAST(ln(1 + GREATEST(d.version, 1)) / ln(11), 1)) DESC,
                 d.updated_at DESC
        LIMIT ${limit}
      `
    },

    async recordRetrievalEvent(event) {
      const rows = await sql<{ id: string }[]>`
        INSERT INTO knowledge_retrieval_events
          (clinic_id, conversation_id, query, language, filters, selected_chunks, answer, handoff_reason, confidence_score, patient_feedback, candidate_id)
        VALUES (
          ${event.clinicId}, ${event.conversationId ?? null}, ${event.query}, ${event.language ?? null},
          ${sql.json(toJson(event.filters ?? {}))}, ${sql.json(toJson(event.selectedChunks))},
          ${event.answer ?? null}, ${event.handoffReason ?? null}, ${event.confidenceScore ?? null}, ${event.patientFeedback ?? 'unknown'}, ${event.candidateId ?? null}
        )
        RETURNING id
      `
      return rows[0]!.id
    },

    async createKnowledgeCandidate(input) {
      const rows = await sql<KnowledgeCandidate[]>`
        INSERT INTO knowledge_candidates
          (clinic_id, retrieval_event_id, source_question, candidate_content, confidence_score, grounding_score,
           medical_safety_ok, prompt_safety_ok, contradiction_free, consistency_count, patient_feedback,
           supporting_chunks, original_source)
        VALUES (${input.clinicId}, ${input.retrievalEventId ?? null}, ${input.sourceQuestion}, ${input.candidateContent},
          ${input.confidenceScore}, ${input.groundingScore}, ${input.medicalSafetyOk}, ${input.promptSafetyOk},
          ${input.contradictionFree}, ${input.consistencyCount ?? 1}, ${input.patientFeedback ?? 'unknown'},
          ${sql.json(toJson(input.supportingChunks))}, ${sql.json(toJson(input.originalSource ?? {}))})
        RETURNING *
      `
      return rows[0]!
    },

    async updateRetrievalFeedback(eventId, feedback, humanEdit = null, humanApproved = false) {
      await sql`
        UPDATE knowledge_retrieval_events
        SET patient_feedback = ${feedback}, human_edit = ${humanEdit}, human_approved = ${humanApproved}
        WHERE id = ${eventId}
      `
    },

    async createChunk(data) {
      const rows = await sql<KnowledgeChunk[]>`
        INSERT INTO knowledge_chunks (document_id, clinic_id, content, chunk_index, metadata)
        VALUES (
          ${data.documentId},
          ${data.clinicId},
          ${data.content},
          ${data.chunkIndex},
          ${sql.json(toJson(data.metadata ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async replaceChunks(clinicId, documentId, chunks) {
      const results: KnowledgeChunk[] = []
      await sql.begin(async (tx) => {
        await tx`DELETE FROM knowledge_chunks WHERE clinic_id = ${clinicId} AND document_id = ${documentId}`
        for (const c of chunks) {
          const rows = await tx<KnowledgeChunk[]>`
            INSERT INTO knowledge_chunks (document_id, clinic_id, content, chunk_index, metadata)
            VALUES (
              ${documentId},
              ${clinicId},
              ${c.content},
              ${c.chunkIndex},
              ${tx.json(toJson(c.metadata ?? {}))}
            )
            RETURNING *
          `
          results.push(rows[0]!)
        }
      })
      return results
    },

    async listIaProfiles(clinicId) {
      return sql<IaProfile[]>`
        SELECT * FROM ia_profiles WHERE clinic_id = ${clinicId} ORDER BY name
      `
    },

    async findIaProfile(clinicId, id) {
      const rows = await sql<IaProfile[]>`
        SELECT * FROM ia_profiles WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1
      `
      return rows[0] ?? null
    },

    async createIaProfile(data) {
      const rows = await sql<IaProfile[]>`
        INSERT INTO ia_profiles (clinic_id, name, system_prompt, model, temperature, max_tokens, settings)
        VALUES (
          ${data.clinicId},
          ${data.name},
          ${data.systemPrompt ?? ''},
          ${data.model        ?? 'claude-sonnet-4-6'},
          ${data.temperature  ?? 0.7},
          ${data.maxTokens    ?? 1024},
          ${sql.json(toJson(data.settings ?? {}))}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async updateIaProfile(clinicId, id, data) {
      const rows = await sql<IaProfile[]>`
        UPDATE ia_profiles SET
          name          = COALESCE(${data.name          ?? null}, name),
          system_prompt = COALESCE(${data.systemPrompt  ?? null}, system_prompt),
          model         = COALESCE(${data.model         ?? null}, model),
          temperature   = COALESCE(${data.temperature   ?? null}, temperature),
          max_tokens    = COALESCE(${data.maxTokens     ?? null}, max_tokens),
          is_active     = COALESCE(${data.isActive      ?? null}, is_active),
          settings      = CASE WHEN ${data.settings !== undefined} THEN ${sql.json(toJson(data.settings ?? {}))} ELSE settings END
        WHERE clinic_id = ${clinicId} AND id = ${id}
        RETURNING *
      `
      if (!rows[0]) throw new Error(`IA profile not found: ${id}`)
      return rows[0]
    },

    async listIaRules(clinicId, iaProfileId) {
      return sql<IaRule[]>`
        SELECT * FROM ia_rules
        WHERE clinic_id = ${clinicId} AND ia_profile_id = ${iaProfileId} AND is_active = TRUE
        ORDER BY priority DESC, created_at
      `
    },

    async createIaRule(data) {
      const rows = await sql<IaRule[]>`
        INSERT INTO ia_rules (ia_profile_id, clinic_id, rule_type, condition, action, priority)
        VALUES (
          ${data.iaProfileId},
          ${data.clinicId},
          ${data.ruleType},
          ${sql.json(toJson(data.condition ?? {}))},
          ${sql.json(toJson(data.action    ?? {}))},
          ${data.priority ?? 0}
        )
        RETURNING *
      `
      return rows[0]!
    },

    async deleteIaRule(clinicId, id) {
      await sql`DELETE FROM ia_rules WHERE clinic_id = ${clinicId} AND id = ${id}`
    },
  }
}
