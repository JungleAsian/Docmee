import { describe, expect, it } from 'vitest'
import type { Sql } from '../client.js'
import { createMediaAssetsRepository } from '../repositories/media-assets.repository.js'

function transactionalSql(queries: string[]): Sql {
  const tagged = async (strings: TemplateStringsArray) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    queries.push(query)
    if (query.includes('RETURNING id')) return [{ id: query.includes('message_attachments') ? 'attachment-1' : 'message-1' }]
    return []
  }
  Object.assign(tagged, {
    json: (value: unknown) => value,
    begin: async (callback: (tx: typeof tagged) => unknown) => callback(tagged),
  })
  return tagged as unknown as Sql
}

describe('media assets outbound provider transitions', () => {
  it('marks the message and attachment accepted in one transaction', async () => {
    const queries: string[] = []
    const repo = createMediaAssetsRepository(transactionalSql(queries))

    await repo.markOutboundAccepted({
      clinicId: 'clinic-1',
      messageId: 'message-1',
      attachmentId: 'attachment-1',
      providerMessageId: 'wamid-1',
      providerMediaId: 'media-1',
    })

    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain('UPDATE conversation_messages')
    expect(queries[1]).toContain('UPDATE message_attachments')
  })

  it('records a failed delivery event and marks the attachment failed in one transaction', async () => {
    const queries: string[] = []
    const repo = createMediaAssetsRepository(transactionalSql(queries))

    await repo.markOutboundFailed({
      clinicId: 'clinic-1',
      messageId: 'message-1',
      attachmentId: 'attachment-1',
      failureCode: 'provider_send_failed',
    })

    expect(queries.some((query) => query.startsWith('INSERT INTO message_delivery_events'))).toBe(true)
    expect(queries.some((query) => query.includes('UPDATE conversation_messages'))).toBe(true)
    expect(queries.some((query) => query.includes('UPDATE message_attachments'))).toBe(true)
  })
})
