import type { Sql, TxSql } from '../client.js'
import { toJson } from '../client.js'
import { randomUUID } from 'node:crypto'
import type {
  AttachmentProviderStatus,
  ContentType,
  ConversationMessage,
  MediaAsset,
  MediaAssetContentType,
  MessageAttachment,
  OutboundMediaAttempt,
} from '../types/index.js'

export interface CreateMediaAssetInput {
  id?: string
  clinicId: string
  uploadedBy?: string | null
  filename: string
  contentType: MediaAssetContentType
  byteSize: number
  checksum: string
  storageKey: string
}

export interface OutboundMediaAttemptBundle {
  attempt: OutboundMediaAttempt
  message: ConversationMessage
  attachment: MessageAttachment
}

export interface PrepareOutboundMediaInput {
  clinicId: string
  conversationId: string
  mediaAssetId: string
  idempotencyKey: string
  authorId: string
  content: string
  contentType: Extract<ContentType, 'image' | 'document'>
  metadata: Record<string, unknown>
}

export interface MediaAssetsRepository {
  list(clinicId: string, includeDeleted?: boolean): Promise<MediaAsset[]>
  findById(clinicId: string, id: string): Promise<MediaAsset | null>
  create(data: CreateMediaAssetInput): Promise<MediaAsset>
  softDelete(clinicId: string, id: string): Promise<boolean>
  activeBytes(clinicId: string): Promise<number>
  activeCount(clinicId: string): Promise<number>
  createWithinQuota(data: CreateMediaAssetInput, limits: { maxFiles: number; maxBytes: number }): Promise<MediaAsset>
  reserveWithinQuota(data: CreateMediaAssetInput & { id: string }, limits: { maxFiles: number; maxBytes: number }): Promise<MediaAsset>
  markUploadReady(clinicId: string, id: string): Promise<void>
  beginDeletion(clinicId: string, id: string): Promise<MediaAsset | null>
  claimDueCleanup(limit?: number): Promise<MediaAsset[]>
  markDeletionComplete(clinicId: string, id: string): Promise<void>
  markDeletionFailed(clinicId: string, id: string, failureCode: string): Promise<void>
  attach(data: { clinicId: string; messageId: string; mediaAssetId: string; providerMessageId?: string | null; providerStatus?: AttachmentProviderStatus }): Promise<MessageAttachment>
  listAttachments(clinicId: string, messageId: string): Promise<MessageAttachment[]>
  updateAttachmentStatus(clinicId: string, id: string, status: AttachmentProviderStatus, providerMessageId?: string | null, failureCode?: string | null): Promise<void>
  findOutboundAttempt(clinicId: string, conversationId: string, idempotencyKey: string): Promise<OutboundMediaAttemptBundle | null>
  prepareOutbound(data: PrepareOutboundMediaInput): Promise<OutboundMediaAttemptBundle & { created: boolean }>
  markOutboundAccepted(data: { clinicId: string; attemptId: string; providerMessageId: string; providerMediaId: string }): Promise<void>
  markOutboundUncertain(data: { clinicId: string; attemptId: string; failureCode: string; providerMessageId?: string | null; providerMediaId?: string | null }): Promise<void>
  markOutboundFailed(data: { clinicId: string; messageId: string; attachmentId: string; failureCode: string }): Promise<void>
}

async function loadAttempt(
  sql: Sql | TxSql,
  clinicId: string,
  conversationId: string,
  idempotencyKey: string,
): Promise<OutboundMediaAttemptBundle | null> {
  const attempts = await sql<OutboundMediaAttempt[]>`
    SELECT * FROM outbound_media_attempts
    WHERE clinic_id = ${clinicId}
      AND conversation_id = ${conversationId}
      AND idempotency_key = ${idempotencyKey}
    LIMIT 1
  `
  const attempt = attempts[0]
  if (!attempt) return null
  const messages = await sql<ConversationMessage[]>`
    SELECT * FROM conversation_messages
    WHERE clinic_id = ${clinicId} AND id = ${attempt.messageId}
    LIMIT 1
  `
  const attachments = await sql<MessageAttachment[]>`
    SELECT * FROM message_attachments
    WHERE clinic_id = ${clinicId} AND id = ${attempt.attachmentId}
    LIMIT 1
  `
  if (!messages[0] || !attachments[0]) throw new Error('Outbound media attempt is incomplete')
  return { attempt, message: messages[0], attachment: attachments[0] }
}

export function createMediaAssetsRepository(sql: Sql): MediaAssetsRepository {
  return {
    async list(clinicId, includeDeleted = false) {
      return sql<MediaAsset[]>`
        SELECT * FROM media_assets
        WHERE clinic_id = ${clinicId} AND (${includeDeleted} OR deleted_at IS NULL)
        ORDER BY created_at DESC
      `
    },
    async findById(clinicId, id) {
      const rows = await sql<MediaAsset[]>`SELECT * FROM media_assets WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1`
      return rows[0] ?? null
    },
    async create(data) {
      const id = data.id ?? randomUUID()
      const rows = await sql<MediaAsset[]>`
        INSERT INTO media_assets (id, clinic_id, uploaded_by, filename, content_type, byte_size, checksum, storage_key, storage_status)
        VALUES (${id}, ${data.clinicId}, ${data.uploadedBy ?? null}, ${data.filename}, ${data.contentType}, ${data.byteSize}, ${data.checksum}, ${data.storageKey}, 'active')
        RETURNING *
      `
      return rows[0]!
    },
    async softDelete(clinicId, id) {
      const rows = await sql<{ id: string }[]>`
        UPDATE media_assets SET deleted_at = NOW(), storage_status = 'deleted'
        WHERE clinic_id = ${clinicId} AND id = ${id} AND deleted_at IS NULL
        RETURNING id
      `
      return rows.length === 1
    },
    async activeBytes(clinicId) {
      const rows = await sql<[{ total: string | null }]>`
        SELECT COALESCE(SUM(byte_size), 0)::text AS total FROM media_assets
        WHERE clinic_id = ${clinicId} AND deleted_at IS NULL
      `
      return Number(rows[0]?.total ?? 0)
    },
    async activeCount(clinicId) {
      const rows = await sql<[{ total: string }]>`
        SELECT COUNT(*)::text AS total FROM media_assets
        WHERE clinic_id = ${clinicId} AND deleted_at IS NULL
      `
      return Number(rows[0]?.total ?? 0)
    },
    async createWithinQuota(data, limits) {
      return (sql.begin(async (tx) => {
        const id = data.id ?? randomUUID()
        await tx`SELECT pg_advisory_xact_lock(hashtext(${data.clinicId}))`
        const usage = await tx<[{ total: string; bytes: string }]>`
          SELECT COUNT(*)::text AS total, COALESCE(SUM(byte_size), 0)::text AS bytes
          FROM media_assets WHERE clinic_id = ${data.clinicId} AND deleted_at IS NULL
        `
        if (Number(usage[0]?.total ?? 0) >= limits.maxFiles) throw new Error('media_file_limit_reached')
        if (Number(usage[0]?.bytes ?? 0) + data.byteSize > limits.maxBytes) throw new Error('media_quota_exceeded')
        const rows = await tx<MediaAsset[]>`
          INSERT INTO media_assets (id, clinic_id, uploaded_by, filename, content_type, byte_size, checksum, storage_key, storage_status)
          VALUES (${id}, ${data.clinicId}, ${data.uploadedBy ?? null}, ${data.filename}, ${data.contentType}, ${data.byteSize}, ${data.checksum}, ${data.storageKey}, 'active')
          RETURNING *
        `
        return rows[0]!
      }) as unknown as Promise<MediaAsset>)
    },
    async reserveWithinQuota(data, limits) {
      return (sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${data.clinicId}))`
        const usage = await tx<[{ total: string; bytes: string }]>`
          SELECT COUNT(*)::text AS total, COALESCE(SUM(byte_size), 0)::text AS bytes
          FROM media_assets WHERE clinic_id = ${data.clinicId} AND deleted_at IS NULL
        `
        if (Number(usage[0]?.total ?? 0) >= limits.maxFiles) throw new Error('media_file_limit_reached')
        if (Number(usage[0]?.bytes ?? 0) + data.byteSize > limits.maxBytes) throw new Error('media_quota_exceeded')
        const rows = await tx<MediaAsset[]>`
          INSERT INTO media_assets (id, clinic_id, uploaded_by, filename, content_type, byte_size, checksum, storage_key, storage_status)
          VALUES (${data.id}, ${data.clinicId}, ${data.uploadedBy ?? null}, ${data.filename}, ${data.contentType}, ${data.byteSize}, ${data.checksum}, ${data.storageKey}, 'uploading')
          RETURNING *
        `
        return rows[0]!
      }) as unknown as Promise<MediaAsset>)
    },
    async markUploadReady(clinicId, id) {
      const rows = await sql<{ id: string }[]>`
        UPDATE media_assets
        SET storage_status = 'active', storage_failure_code = NULL, storage_cleanup_retry_at = NULL
        WHERE clinic_id = ${clinicId} AND id = ${id} AND deleted_at IS NULL AND storage_status = 'uploading'
        RETURNING id
      `
      if (rows.length !== 1) throw new Error('Reserved media asset not found')
    },
    async beginDeletion(clinicId, id) {
      return (sql.begin(async (tx) => {
        const rows = await tx<MediaAsset[]>`
          SELECT * FROM media_assets
          WHERE clinic_id = ${clinicId} AND id = ${id} AND deleted_at IS NULL
          FOR UPDATE
        `
        if (!rows[0]) return null
        const updated = await tx<MediaAsset[]>`
          UPDATE media_assets
          SET storage_status = 'delete_pending', storage_failure_code = NULL,
              storage_cleanup_attempts = storage_cleanup_attempts + 1,
              storage_cleanup_retry_at = NULL
          WHERE clinic_id = ${clinicId} AND id = ${id} AND deleted_at IS NULL
          RETURNING *
        `
        return updated[0] ?? null
      }) as unknown as Promise<MediaAsset | null>)
    },
    async claimDueCleanup(limit = 25) {
      const claimLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
      return sql<MediaAsset[]>`
        WITH due_cleanup AS (
          SELECT id
          FROM media_assets
          WHERE deleted_at IS NULL
            AND (
              (storage_status = 'delete_failed' AND storage_cleanup_retry_at <= NOW())
              OR (storage_status = 'delete_pending' AND updated_at <= NOW() - INTERVAL '10 minutes')
              OR (storage_status = 'uploading' AND created_at <= NOW() - INTERVAL '30 minutes')
            )
          ORDER BY COALESCE(storage_cleanup_retry_at, updated_at, created_at), id
          FOR UPDATE SKIP LOCKED
          LIMIT ${claimLimit}
        )
        UPDATE media_assets
        SET storage_status = 'delete_pending', storage_failure_code = NULL,
            storage_cleanup_attempts = media_assets.storage_cleanup_attempts + 1,
            storage_cleanup_retry_at = NULL, updated_at = NOW()
        FROM due_cleanup
        WHERE media_assets.id = due_cleanup.id
        RETURNING media_assets.*
      `
    },
    async markDeletionComplete(clinicId, id) {
      const rows = await sql<{ id: string }[]>`
        UPDATE media_assets
        SET storage_status = 'deleted', storage_failure_code = NULL,
            storage_cleanup_retry_at = NULL, deleted_at = NOW()
        WHERE clinic_id = ${clinicId} AND id = ${id} AND deleted_at IS NULL
        RETURNING id
      `
      if (rows.length !== 1) throw new Error('Media asset cleanup target not found')
    },
    async markDeletionFailed(clinicId, id, failureCode) {
      const rows = await sql<{ id: string }[]>`
        UPDATE media_assets
        SET storage_status = 'delete_failed', storage_failure_code = ${failureCode},
            storage_cleanup_retry_at = NOW() + INTERVAL '5 minutes'
        WHERE clinic_id = ${clinicId} AND id = ${id} AND deleted_at IS NULL
        RETURNING id
      `
      if (rows.length !== 1) throw new Error('Media asset cleanup target not found')
    },
    async attach(data) {
      const rows = await sql<MessageAttachment[]>`
        INSERT INTO message_attachments (clinic_id, message_id, media_asset_id, provider_message_id, provider_status)
        VALUES (${data.clinicId}, ${data.messageId}, ${data.mediaAssetId}, ${data.providerMessageId ?? null}, ${data.providerStatus ?? 'pending'})
        ON CONFLICT (message_id, media_asset_id) DO UPDATE
        SET provider_message_id = EXCLUDED.provider_message_id, provider_status = EXCLUDED.provider_status
        RETURNING *
      `
      return rows[0]!
    },
    async listAttachments(clinicId, messageId) {
      return sql<MessageAttachment[]>`
        SELECT * FROM message_attachments
        WHERE clinic_id = ${clinicId} AND message_id = ${messageId}
        ORDER BY created_at
      `
    },
    async updateAttachmentStatus(clinicId, id, status, providerMessageId = null, failureCode = null) {
      await sql`
        UPDATE message_attachments
        SET provider_status = ${status}, provider_message_id = COALESCE(${providerMessageId}, provider_message_id), failure_code = ${failureCode}
        WHERE clinic_id = ${clinicId} AND id = ${id}
      `
    },
    async findOutboundAttempt(clinicId, conversationId, idempotencyKey) {
      return loadAttempt(sql, clinicId, conversationId, idempotencyKey)
    },
    async prepareOutbound(data) {
      return (sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtext(${data.clinicId}), hashtext(${`${data.conversationId}:${data.idempotencyKey}`}))`
        const existing = await loadAttempt(tx, data.clinicId, data.conversationId, data.idempotencyKey)
        if (existing) return { ...existing, created: false }

        const conversations = await tx<Array<{ id: string; channel: string; status: string }>>`
          SELECT id, channel, status FROM conversations
          WHERE clinic_id = ${data.clinicId} AND id = ${data.conversationId}
          FOR UPDATE
        `
        const conversation = conversations[0]
        if (!conversation) throw new Error('conversation_not_found')
        if (conversation.channel !== 'whatsapp') throw new Error('conversation_channel_not_supported')

        const messages = await tx<ConversationMessage[]>`
          INSERT INTO conversation_messages
            (conversation_id, clinic_id, role, content, content_type, channel_message_id, metadata)
          VALUES (
            ${data.conversationId}, ${data.clinicId}, 'agent', ${data.content}, ${data.contentType}, NULL,
            ${tx.json(toJson({ ...data.metadata, providerStatus: 'sending', idempotencyKey: data.idempotencyKey }))}
          )
          RETURNING *
        `
        const message = messages[0]!
        const attachments = await tx<MessageAttachment[]>`
          INSERT INTO message_attachments (clinic_id, message_id, media_asset_id, provider_message_id, provider_status)
          VALUES (${data.clinicId}, ${message.id}, ${data.mediaAssetId}, NULL, 'pending')
          RETURNING *
        `
        const attachment = attachments[0]!

        await tx`
          UPDATE conversations
          SET status = CASE WHEN status = 'open' THEN 'handoff' ELSE status END,
              metadata = CASE WHEN status = 'open'
                THEN COALESCE(metadata, '{}'::jsonb) || ${tx.json(toJson({ botPausedAt: new Date().toISOString(), handoffReason: 'human_reply' }))}
                ELSE metadata
              END,
              updated_at = NOW()
          WHERE clinic_id = ${data.clinicId} AND id = ${data.conversationId}
        `

        const attempts = await tx<OutboundMediaAttempt[]>`
          INSERT INTO outbound_media_attempts
            (clinic_id, conversation_id, message_id, attachment_id, media_asset_id, idempotency_key, status)
          VALUES (
            ${data.clinicId}, ${data.conversationId}, ${message.id}, ${attachment.id},
            ${data.mediaAssetId}, ${data.idempotencyKey}, 'sending'
          )
          RETURNING *
        `
        return { created: true, attempt: attempts[0]!, message, attachment }
      }) as unknown as Promise<OutboundMediaAttemptBundle & { created: boolean }>)
    },
    async markOutboundAccepted(data) {
      await (sql.begin(async (tx) => {
        const attempts = await tx<OutboundMediaAttempt[]>`
          UPDATE outbound_media_attempts
          SET status = 'accepted', provider_message_id = ${data.providerMessageId},
              provider_media_id = ${data.providerMediaId}, failure_code = NULL
          WHERE clinic_id = ${data.clinicId} AND id = ${data.attemptId}
          RETURNING *
        `
        const attempt = attempts[0]
        if (!attempt) throw new Error('Outbound media attempt not found')
        const messageRows = await tx<{ id: string }[]>`
          UPDATE conversation_messages
          SET channel_message_id = ${data.providerMessageId},
              metadata = COALESCE(metadata, '{}'::jsonb) || ${tx.json(toJson({ mediaId: data.providerMediaId, providerStatus: 'accepted', providerAccepted: true, providerAcceptedAt: new Date().toISOString() }))}
          WHERE clinic_id = ${data.clinicId} AND id = ${attempt.messageId}
          RETURNING id
        `
        if (messageRows.length !== 1) throw new Error('Outbound media message not found')
        const attachmentRows = await tx<{ id: string }[]>`
          UPDATE message_attachments
          SET provider_status = 'accepted', provider_message_id = ${data.providerMessageId}, failure_code = NULL
          WHERE clinic_id = ${data.clinicId} AND id = ${attempt.attachmentId} AND message_id = ${attempt.messageId}
          RETURNING id
        `
        if (attachmentRows.length !== 1) throw new Error('Outbound media attachment not found')
      }) as unknown as Promise<void>)
    },
    async markOutboundUncertain(data) {
      await (sql.begin(async (tx) => {
        const attempts = await tx<OutboundMediaAttempt[]>`
          UPDATE outbound_media_attempts
          SET status = 'uncertain', failure_code = ${data.failureCode},
              provider_message_id = COALESCE(${data.providerMessageId ?? null}, provider_message_id),
              provider_media_id = COALESCE(${data.providerMediaId ?? null}, provider_media_id)
          WHERE clinic_id = ${data.clinicId} AND id = ${data.attemptId}
          RETURNING *
        `
        const attempt = attempts[0]
        if (!attempt) throw new Error('Outbound media attempt not found')
        const messageRows = await tx<{ id: string }[]>`
          UPDATE conversation_messages
          SET metadata = COALESCE(metadata, '{}'::jsonb) || ${tx.json(toJson({ providerStatus: 'uncertain', providerRetrySafe: false, providerFailureCode: data.failureCode }))}
          WHERE clinic_id = ${data.clinicId} AND id = ${attempt.messageId}
          RETURNING id
        `
        if (messageRows.length !== 1) throw new Error('Outbound media message not found')
        const attachmentRows = await tx<{ id: string }[]>`
          UPDATE message_attachments
          SET provider_status = 'uncertain', failure_code = ${data.failureCode},
              provider_message_id = COALESCE(${data.providerMessageId ?? null}, provider_message_id)
          WHERE clinic_id = ${data.clinicId} AND id = ${attempt.attachmentId} AND message_id = ${attempt.messageId}
          RETURNING id
        `
        if (attachmentRows.length !== 1) throw new Error('Outbound media attachment not found')
      }) as unknown as Promise<void>)
    },
    async markOutboundFailed(data) {
      await (sql.begin(async (tx) => {
        const messageRows = await tx<{ id: string }[]>`
          UPDATE conversation_messages
          SET metadata = COALESCE(metadata, '{}'::jsonb) || ${tx.json(toJson({ providerStatus: 'failed' }))}
          WHERE clinic_id = ${data.clinicId} AND id = ${data.messageId}
          RETURNING id
        `
        if (messageRows.length !== 1) throw new Error('Outbound media message not found')
        await tx`
          INSERT INTO message_delivery_events (message_id, clinic_id, channel_message_id, status, error)
          VALUES (${data.messageId}, ${data.clinicId}, NULL, 'failed', ${data.failureCode})
        `
        const attachmentRows = await tx<{ id: string }[]>`
          UPDATE message_attachments
          SET provider_status = 'failed', failure_code = ${data.failureCode}
          WHERE clinic_id = ${data.clinicId} AND id = ${data.attachmentId} AND message_id = ${data.messageId}
          RETURNING id
        `
        if (attachmentRows.length !== 1) throw new Error('Outbound media attachment not found')
      }) as unknown as Promise<void>)
    },
  }
}
