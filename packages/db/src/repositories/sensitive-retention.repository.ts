import type { Sql } from '../client.js'
import { toJson } from '../client.js'
import { createKnowledgeLearningRepository } from './knowledge-learning.repository.js'

const SENSITIVE_TRANSIENT_RETENTION_POLICY = 'sensitive-transient-24h'

export interface SensitiveRetentionPurgeResult {
  webhookEvents: number
  knowledgeRetrievalEvents: number
  notificationEvents: number
  errorReviews: number
  aiUsageMetadataScrubbed: number
}

export interface SensitiveRetentionRepository {
  /**
   * Purges raw transient payloads older than the hard retention cutoff.
   *
   * AI usage rows are intentionally not deleted because they are used for durable
   * cost accounting; only their free-form metadata is scrubbed after the same
   * sensitive-data window.
   */
  purgeExpiredTransientData(cutoff: Date): Promise<SensitiveRetentionPurgeResult>
}

type CountRow = { deletedCount?: string | number; deleted_count?: string | number }

function count(row: CountRow | undefined): number {
  const value = row?.deletedCount ?? row?.deleted_count ?? 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

export function createSensitiveRetentionRepository(sql: Sql): SensitiveRetentionRepository {
  return {
    async purgeExpiredTransientData(cutoff) {
      const purgedMarker = {
        retentionPolicy: SENSITIVE_TRANSIENT_RETENTION_POLICY,
        retentionPurgedAt: new Date().toISOString(),
      }

      const webhookEvents = await sql<CountRow[]>`
        WITH purged AS (
          DELETE FROM webhook_events
          WHERE created_at <= ${cutoff.toISOString()}
          RETURNING id
        )
        SELECT COUNT(*)::int AS deleted_count FROM purged
      `
      const knowledgeRetrievalEvents = await sql<CountRow[]>`
        WITH purged AS (
          DELETE FROM knowledge_retrieval_events
          WHERE created_at <= ${cutoff.toISOString()}
          RETURNING id
        )
        SELECT COUNT(*)::int AS deleted_count FROM purged
      `
      const notificationEvents = await sql<CountRow[]>`
        WITH purged AS (
          DELETE FROM notification_events
          WHERE created_at <= ${cutoff.toISOString()}
          RETURNING id
        )
        SELECT COUNT(*)::int AS deleted_count FROM purged
      `
      const errorReviews = await sql<CountRow[]>`
        WITH purged AS (
          DELETE FROM error_reviews
          WHERE created_at <= ${cutoff.toISOString()}
          RETURNING id
        )
        SELECT COUNT(*)::int AS deleted_count FROM purged
      `
      const aiUsageMetadataScrubbed = await sql<CountRow[]>`
        WITH scrubbed AS (
          UPDATE ai_usage_events
          SET metadata = ${sql.json(toJson(purgedMarker))}
          WHERE created_at <= ${cutoff.toISOString()}
            AND COALESCE(metadata ->> 'retentionPolicy', '') <> ${SENSITIVE_TRANSIENT_RETENTION_POLICY}
            AND metadata <> '{}'::jsonb
          RETURNING id
        )
        SELECT COUNT(*)::int AS deleted_count FROM scrubbed
      `

      await createKnowledgeLearningRepository(sql).purgeExpired()
      return {
        webhookEvents: count(webhookEvents[0]),
        knowledgeRetrievalEvents: count(knowledgeRetrievalEvents[0]),
        notificationEvents: count(notificationEvents[0]),
        errorReviews: count(errorReviews[0]),
        aiUsageMetadataScrubbed: count(aiUsageMetadataScrubbed[0]),
      }
    },
  }
}
