import { describe, expect, it } from 'vitest'
import { createSensitiveRetentionRepository } from '../repositories/sensitive-retention.repository.js'

function sqlRecorder(queries: string[]) {
  const tagged = async (strings: TemplateStringsArray) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    queries.push(query)
    return [{ deleted_count: '3' }]
  }
  Object.assign(tagged, {
    json: (value: unknown) => value,
    begin: async (callback: (tx: typeof tagged) => unknown) => callback(tagged),
  })
  return tagged
}

describe('sensitive retention repository', () => {
  it('purges raw transient payloads and scrubs AI usage metadata while preserving usage rows', async () => {
    const queries: string[] = []
    const repo = createSensitiveRetentionRepository(sqlRecorder(queries) as never)

    const result = await repo.purgeExpiredTransientData(new Date('2026-09-07T15:30:00.000Z'))

    expect(result.webhookEvents).toBe(3)
    expect(result.knowledgeRetrievalEvents).toBe(3)
    expect(result.notificationEvents).toBe(3)
    expect(result.errorReviews).toBe(3)
    expect(result.aiUsageMetadataScrubbed).toBe(3)
    expect(queries).toHaveLength(8)
    expect(queries[5]).toContain('DELETE FROM knowledge_learning_events')
    expect(queries[6]).toContain('DELETE FROM knowledge_gaps')
    expect(queries[7]).toContain("status IN ('pending_review', 'rejected')")
    expect(queries[0]).toContain('DELETE FROM webhook_events')
    expect(queries[1]).toContain('DELETE FROM knowledge_retrieval_events')
    expect(queries[2]).toContain('DELETE FROM notification_events')
    expect(queries[3]).toContain('DELETE FROM error_reviews')
    expect(queries[4]).toContain('UPDATE ai_usage_events')
    expect(queries[4]).toContain('metadata')
    expect(queries[4]).not.toContain('DELETE FROM ai_usage_events')
  })
})
