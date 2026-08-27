import { describe, expect, it } from 'vitest'
import type { Sql } from '../client.js'
import { createMediaAssetsRepository } from '../repositories/media-assets.repository.js'

function transactionalSql(queries: string[], onQuery?: (query: string) => unknown[]): Sql {
  const tagged = async (strings: TemplateStringsArray) => {
    const query = strings.join('?').replace(/\s+/g, ' ').trim()
    queries.push(query)
    return onQuery?.(query) ?? []
  }
  Object.assign(tagged, {
    json: (value: unknown) => value,
    begin: async (callback: (tx: typeof tagged) => unknown) => callback(tagged),
  })
  return tagged as unknown as Sql
}

const message = {
  id: 'message-1',
  conversationId: 'conversation-1',
  clinicId: 'clinic-1',
  role: 'agent',
  content: '',
  contentType: 'image',
  channelMessageId: null,
  audioUrl: null,
  transcription: null,
  tokenCount: null,
  classification: null,
  classificationConfidence: null,
  classificationSource: null,
  metadata: { providerStatus: 'sending' },
  createdAt: '2026-08-27T00:00:00.000Z',
}

const attachment = {
  id: 'attachment-1',
  clinicId: 'clinic-1',
  messageId: 'message-1',
  mediaAssetId: 'asset-1',
  providerMessageId: null,
  providerStatus: 'pending',
  failureCode: null,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
}

const attempt = {
  id: 'attempt-1',
  clinicId: 'clinic-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  attachmentId: 'attachment-1',
  mediaAssetId: 'asset-1',
  idempotencyKey: 'request-001',
  status: 'sending',
  providerMediaId: null,
  providerMessageId: null,
  failureCode: null,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
}

describe('media assets durable state transitions', () => {
  it('atomically claims due and stale cleanup rows without double-consuming them', async () => {
    const queries: string[] = []
    const claimed = {
      id: 'asset-1',
      clinicId: 'clinic-1',
      uploadedBy: 'staff-1',
      filename: 'scan.png',
      contentType: 'image/png',
      byteSize: 42,
      checksum: 'checksum',
      storageKey: 'voice-notes/clinic-1/media/asset-1/scan.png',
      storageStatus: 'delete_pending',
      storageFailureCode: null,
      storageCleanupAttempts: 2,
      storageCleanupRetryAt: null,
      deletedAt: null,
      createdAt: '2026-08-27T00:00:00.000Z',
      updatedAt: '2026-08-27T00:10:00.000Z',
    }
    const repo = createMediaAssetsRepository(transactionalSql(queries, () => [claimed]))

    const result = await repo.claimDueCleanup(25)

    expect(result).toEqual([claimed])
    expect(queries).toHaveLength(1)
    expect(queries[0]).toContain("storage_status = 'delete_failed'")
    expect(queries[0]).toContain('storage_cleanup_retry_at <= NOW()')
    expect(queries[0]).toContain("storage_status = 'delete_pending'")
    expect(queries[0]).toContain("storage_status = 'uploading'")
    expect(queries[0]).toContain('FOR UPDATE SKIP LOCKED')
    expect(queries[0]).toContain("SET storage_status = 'delete_pending'")
    expect(queries[0]).toContain('storage_cleanup_attempts = media_assets.storage_cleanup_attempts + 1')
    expect(queries[0]).toContain('RETURNING media_assets.*')
  })

  it('prepares the idempotent attempt, message, attachment, and locked handoff in one transaction', async () => {
    const queries: string[] = []
    const repo = createMediaAssetsRepository(transactionalSql(queries, (query) => {
      if (query.includes('FROM outbound_media_attempts')) return []
      if (query.includes('FROM conversations') && query.includes('FOR UPDATE')) return [{ id: 'conversation-1', channel: 'whatsapp', status: 'open' }]
      if (query.startsWith('INSERT INTO conversation_messages')) return [message]
      if (query.startsWith('INSERT INTO message_attachments')) return [attachment]
      if (query.startsWith('INSERT INTO outbound_media_attempts')) return [attempt]
      return []
    }))

    const prepared = await repo.prepareOutbound({
      clinicId: 'clinic-1',
      conversationId: 'conversation-1',
      mediaAssetId: 'asset-1',
      idempotencyKey: 'request-001',
      authorId: 'staff-1',
      content: '',
      contentType: 'image',
      metadata: { filename: 'scan.png' },
    })

    expect(prepared.created).toBe(true)
    expect(queries[0]).toContain('pg_advisory_xact_lock')
    expect(queries.some((query) => query.includes('FROM conversations') && query.includes('FOR UPDATE'))).toBe(true)
    expect(queries.some((query) => query.startsWith('INSERT INTO conversation_messages'))).toBe(true)
    expect(queries.some((query) => query.startsWith('INSERT INTO message_attachments'))).toBe(true)
    expect(queries.some((query) => query.startsWith('UPDATE conversations'))).toBe(true)
    expect(queries.at(-1)).toContain('INSERT INTO outbound_media_attempts')
  })

  it('returns the existing attempt under the same idempotency key without creating another message', async () => {
    const queries: string[] = []
    const repo = createMediaAssetsRepository(transactionalSql(queries, (query) => {
      if (query.includes('FROM outbound_media_attempts')) return [attempt]
      if (query.includes('FROM conversation_messages')) return [message]
      if (query.includes('FROM message_attachments')) return [attachment]
      return []
    }))

    const prepared = await repo.prepareOutbound({
      clinicId: 'clinic-1', conversationId: 'conversation-1', mediaAssetId: 'asset-1',
      idempotencyKey: 'request-001', authorId: 'staff-1', content: '', contentType: 'image', metadata: {},
    })

    expect(prepared.created).toBe(false)
    expect(queries.some((query) => query.startsWith('INSERT INTO conversation_messages'))).toBe(false)
    expect(queries.some((query) => query.startsWith('INSERT INTO outbound_media_attempts'))).toBe(false)
  })

  it('reconciles provider acceptance across attempt, message, and attachment atomically', async () => {
    const queries: string[] = []
    const repo = createMediaAssetsRepository(transactionalSql(queries, (query) => {
      if (query.startsWith('UPDATE outbound_media_attempts')) return [{ ...attempt, status: 'accepted' }]
      if (query.includes('UPDATE conversation_messages')) return [{ id: 'message-1' }]
      if (query.includes('UPDATE message_attachments')) return [{ id: 'attachment-1' }]
      return []
    }))

    await repo.markOutboundAccepted({ clinicId: 'clinic-1', attemptId: 'attempt-1', providerMessageId: 'wamid-1', providerMediaId: 'media-1' })

    expect(queries).toHaveLength(3)
    expect(queries[0]).toContain("status = 'accepted'")
    expect(queries[1]).toContain('UPDATE conversation_messages')
    expect(queries[2]).toContain('UPDATE message_attachments')
  })

  it('marks ambiguous delivery uncertain without a failed delivery event', async () => {
    const queries: string[] = []
    const repo = createMediaAssetsRepository(transactionalSql(queries, (query) => {
      if (query.startsWith('UPDATE outbound_media_attempts')) return [{ ...attempt, status: 'uncertain' }]
      if (query.includes('UPDATE conversation_messages')) return [{ id: 'message-1' }]
      if (query.includes('UPDATE message_attachments')) return [{ id: 'attachment-1' }]
      return []
    }))

    await repo.markOutboundUncertain({ clinicId: 'clinic-1', attemptId: 'attempt-1', failureCode: 'provider_outcome_uncertain' })

    expect(queries[0]).toContain("status = 'uncertain'")
    expect(queries.some((query) => query.includes('INSERT INTO message_delivery_events'))).toBe(false)
    expect(queries.at(-1)).toContain("provider_status = 'uncertain'")
  })

  it('keeps failed physical cleanup undeleted so quota accounting still includes it', async () => {
    const queries: string[] = []
    const repo = createMediaAssetsRepository(transactionalSql(queries, (query) => query.includes('RETURNING id') ? [{ id: 'asset-1' }] : []))

    await repo.markDeletionFailed('clinic-1', 'asset-1', 's3_delete_failed')

    expect(queries[0]).toContain("storage_status = 'delete_failed'")
    expect(queries[0]).not.toContain('deleted_at = NOW()')
  })
})
