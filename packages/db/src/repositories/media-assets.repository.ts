import type { Sql } from '../client.js'
import type { MediaAsset, MediaAssetContentType, MessageAttachment, AttachmentProviderStatus } from '../types/index.js'

export interface CreateMediaAssetInput {
  clinicId: string
  uploadedBy?: string | null
  filename: string
  contentType: MediaAssetContentType
  byteSize: number
  checksum: string
  storageKey: string
}

export interface MediaAssetsRepository {
  list(clinicId: string, includeDeleted?: boolean): Promise<MediaAsset[]>
  findById(clinicId: string, id: string): Promise<MediaAsset | null>
  create(data: CreateMediaAssetInput): Promise<MediaAsset>
  softDelete(clinicId: string, id: string): Promise<boolean>
  activeBytes(clinicId: string): Promise<number>
  attach(data: { clinicId: string; messageId: string; mediaAssetId: string; providerMessageId?: string | null; providerStatus?: AttachmentProviderStatus }): Promise<MessageAttachment>
  listAttachments(clinicId: string, messageId: string): Promise<MessageAttachment[]>
  updateAttachmentStatus(clinicId: string, id: string, status: AttachmentProviderStatus, providerMessageId?: string | null, failureCode?: string | null): Promise<void>
}

export function createMediaAssetsRepository(sql: Sql): MediaAssetsRepository {
  return {
    async list(clinicId, includeDeleted = false) { return sql<MediaAsset[]>`SELECT * FROM media_assets WHERE clinic_id = ${clinicId} AND (${includeDeleted} OR deleted_at IS NULL) ORDER BY created_at DESC` },
    async findById(clinicId, id) { const rows = await sql<MediaAsset[]>`SELECT * FROM media_assets WHERE clinic_id = ${clinicId} AND id = ${id} LIMIT 1`; return rows[0] ?? null },
    async create(data) { const rows = await sql<MediaAsset[]>`INSERT INTO media_assets (clinic_id, uploaded_by, filename, content_type, byte_size, checksum, storage_key) VALUES (${data.clinicId}, ${data.uploadedBy ?? null}, ${data.filename}, ${data.contentType}, ${data.byteSize}, ${data.checksum}, ${data.storageKey}) RETURNING *`; return rows[0]! },
    async softDelete(clinicId, id) { const rows = await sql<{ id: string }[]>`UPDATE media_assets SET deleted_at = NOW() WHERE clinic_id = ${clinicId} AND id = ${id} AND deleted_at IS NULL RETURNING id`; return rows.length === 1 },
    async activeBytes(clinicId) { const rows = await sql<[{ total: string | null }]>`SELECT COALESCE(SUM(byte_size), 0)::text AS total FROM media_assets WHERE clinic_id = ${clinicId} AND deleted_at IS NULL`; return Number(rows[0]?.total ?? 0) },
    async attach(data) { const rows = await sql<MessageAttachment[]>`INSERT INTO message_attachments (clinic_id, message_id, media_asset_id, provider_message_id, provider_status) VALUES (${data.clinicId}, ${data.messageId}, ${data.mediaAssetId}, ${data.providerMessageId ?? null}, ${data.providerStatus ?? 'pending'}) ON CONFLICT (message_id, media_asset_id) DO UPDATE SET provider_message_id = EXCLUDED.provider_message_id, provider_status = EXCLUDED.provider_status RETURNING *`; return rows[0]! },
    async listAttachments(clinicId, messageId) { return sql<MessageAttachment[]>`SELECT * FROM message_attachments WHERE clinic_id = ${clinicId} AND message_id = ${messageId} ORDER BY created_at` },
    async updateAttachmentStatus(clinicId, id, status, providerMessageId = null, failureCode = null) { await sql`UPDATE message_attachments SET provider_status = ${status}, provider_message_id = COALESCE(${providerMessageId}, provider_message_id), failure_code = ${failureCode} WHERE clinic_id = ${clinicId} AND id = ${id}` },
  }
}
