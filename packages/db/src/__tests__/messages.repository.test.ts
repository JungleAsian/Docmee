import { describe, expect, it } from 'vitest'
import type { Sql } from '../client.js'
import { createMessagesRepository } from '../repositories/messages.repository.js'

describe('messages delivery correlation recovery', () => {
  it('reconciles a provider-accepted wamid from the durable error review before recording its receipt', async () => {
    const queries: string[] = []
    const tagged = async (strings: TemplateStringsArray) => {
      const query = strings.join('?').replace(/\s+/g, ' ').trim()
      queries.push(query)
      if (query.startsWith('SELECT id FROM conversation_messages')) return []
      if (query.includes('FROM error_reviews e')) return [{ id: 'message-1', reviewId: 'review-1' }]
      if (query.startsWith('UPDATE conversation_messages')) return [{ id: 'message-1' }]
      return []
    }
    Object.assign(tagged, { json: (value: unknown) => value })
    const repo = createMessagesRepository(tagged as unknown as Sql)

    const matched = await repo.recordDeliveryStatus(
      'clinic-1',
      'wamid.accepted',
      'delivered',
      null,
    )

    expect(matched).toBe(true)
    expect(queries.some((query) => query.includes("e.error_type = 'provider_acceptance_persistence_failure'"))).toBe(true)
    expect(queries.some((query) => query.startsWith('UPDATE conversation_messages'))).toBe(true)
    expect(queries.some((query) => query.startsWith('INSERT INTO message_delivery_events'))).toBe(true)
  })
})
