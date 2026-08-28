import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { createMediaAssetsRepository } from '@docmee/db'
import { withDb } from './db.js'
import {
  deleteKbVaultObject,
  MEDIA_ASSET_MAX_ACTIVE_FILES,
  MEDIA_ASSET_QUOTA_BYTES,
  mediaObjectKey,
  uploadKbVaultObject,
  validateMediaAsset,
} from './kb-vault-storage.js'

export type MediaAssetIngestErrorCode =
  | 'empty'
  | 'too_large'
  | 'unsupported_type'
  | 'invalid_signature'
  | 'file_limit'
  | 'quota_exceeded'
  | 'storage_failed'

export class MediaAssetIngestError extends Error {
  constructor(public readonly code: MediaAssetIngestErrorCode) {
    super(code)
    this.name = 'MediaAssetIngestError'
  }
}

async function readPrefix(path: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of createReadStream(path, { start: 0, end: 511 })) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function ingestMediaAssetFromPath(input: {
  clinicId: string
  uploadedBy: string
  filename: string
  contentType: string
  tempPath: string
  logError?: (message: string) => void
}) {
  const stat = await fs.stat(input.tempPath)
  const validationError = validateMediaAsset({
    contentType: input.contentType,
    byteSize: stat.size,
    signatureBytes: await readPrefix(input.tempPath),
  })
  if (validationError) throw new MediaAssetIngestError(validationError)

  const checksumHash = createHash('sha256')
  for await (const chunk of createReadStream(input.tempPath)) checksumHash.update(chunk)
  const checksum = checksumHash.digest('hex')
  const assetId = randomUUID()
  const key = mediaObjectKey({ clinicId: input.clinicId, assetId, fileName: input.filename || 'attachment' })

  let asset
  try {
    asset = await withDb((sql) => createMediaAssetsRepository(sql).reserveWithinQuota({
      id: assetId,
      clinicId: input.clinicId,
      uploadedBy: input.uploadedBy,
      filename: input.filename || 'attachment',
      contentType: input.contentType as never,
      byteSize: stat.size,
      checksum,
      storageKey: key,
    }, { maxFiles: MEDIA_ASSET_MAX_ACTIVE_FILES, maxBytes: MEDIA_ASSET_QUOTA_BYTES }))
  } catch (error) {
    if (error instanceof Error && error.message === 'media_file_limit_reached') throw new MediaAssetIngestError('file_limit')
    if (error instanceof Error && error.message === 'media_quota_exceeded') throw new MediaAssetIngestError('quota_exceeded')
    throw error
  }

  try {
    const uploaded = await uploadKbVaultObject({
      key,
      body: createReadStream(input.tempPath),
      contentType: input.contentType,
      metadata: { clinicId: input.clinicId, checksum },
    })
    if (!uploaded) throw new Error('S3 storage is unavailable')
    await withDb((sql) => createMediaAssetsRepository(sql).markUploadReady(input.clinicId, asset.id))
  } catch (error) {
    await withDb((sql) => createMediaAssetsRepository(sql).beginDeletion(input.clinicId, asset.id)).catch(() => undefined)
    try {
      const deleted = await deleteKbVaultObject(key)
      if (!deleted) throw new Error('S3 storage is unavailable')
      await withDb((sql) => createMediaAssetsRepository(sql).markDeletionComplete(input.clinicId, asset.id))
    } catch {
      await withDb((sql) => createMediaAssetsRepository(sql).markDeletionFailed(input.clinicId, asset.id, 's3_delete_failed')).catch((persistError) => {
        input.logError?.(`[media-assets] failed to persist cleanup failure: ${(persistError as Error).message}`)
      })
    }
    input.logError?.(`[media-assets] private storage upload failed: ${(error as Error).message}`)
    throw new MediaAssetIngestError('storage_failed')
  }

  return { ...asset, storageStatus: 'active' as const }
}

export function mediaAssetIngestHttpError(error: MediaAssetIngestError): { status: number; message: string } {
  switch (error.code) {
    case 'empty': return { status: 400, message: 'Empty files are not allowed' }
    case 'too_large': return { status: 413, message: 'File exceeds the 100 MB limit' }
    case 'unsupported_type': return { status: 400, message: 'Only PDF, JPEG, PNG, and WebP files are supported' }
    case 'invalid_signature': return { status: 400, message: 'File content does not match its declared type' }
    case 'file_limit': return { status: 413, message: 'Clinic media file limit reached (10 active files)' }
    case 'quota_exceeded': return { status: 413, message: 'Clinic media quota exceeded' }
    case 'storage_failed': return { status: 503, message: 'Private media storage upload failed' }
  }
}
