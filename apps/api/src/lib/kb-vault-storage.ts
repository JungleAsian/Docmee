import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Readable } from 'node:stream'

const REGION =
  process.env['S3_BUCKET_KB_REGION']?.trim() ||
  process.env['DOCMEE_KB_S3_REGION']?.trim() ||
  process.env['AWS_REGION']?.trim() ||
  process.env['AWS_DEFAULT_REGION']?.trim() ||
  ''
const BUCKET =
  process.env['S3_BUCKET_KB']?.trim() ||
  process.env['DOCMEE_KB_S3_BUCKET']?.trim() ||
  process.env['S3_BUCKET_VOICE_NOTES']?.trim() ||
  ''
const PREFIX = (process.env['DOCMEE_KB_S3_PREFIX']?.trim() || 'voice-notes').replace(/^\/+|\/+$/g, '')

let client: S3Client | null = null

export const MEDIA_ASSET_MAX_ACTIVE_FILES = 10
export const MEDIA_ASSET_MAX_BYTES = 100 * 1024 * 1024
export const MEDIA_ASSET_QUOTA_BYTES = 100 * 1024 * 1024
export const WHATSAPP_IMAGE_MAX_BYTES = 5 * 1024 * 1024

export type SupportedMediaAssetContentType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'

const SUPPORTED_MEDIA_ASSET_TYPES = new Set<SupportedMediaAssetContentType>([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
])

export function isSupportedMediaAssetContentType(value: string): value is SupportedMediaAssetContentType {
  return SUPPORTED_MEDIA_ASSET_TYPES.has(value as SupportedMediaAssetContentType)
}

export function hasValidMediaAssetSignature(contentType: SupportedMediaAssetContentType, bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes)
  if (contentType === 'application/pdf') return prefix.subarray(0, 5).toString('ascii') === '%PDF-'
  if (contentType === 'image/jpeg') return prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff
  if (contentType === 'image/png') return prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  return prefix.subarray(0, 4).toString('ascii') === 'RIFF' && prefix.subarray(8, 12).toString('ascii') === 'WEBP'
}

export type MediaAssetValidationError = 'empty' | 'too_large' | 'unsupported_type' | 'invalid_signature'

export function validateMediaAsset(input: {
  contentType: string
  byteSize: number
  signatureBytes: Uint8Array
}): MediaAssetValidationError | null {
  if (input.byteSize <= 0) return 'empty'
  if (input.byteSize > MEDIA_ASSET_MAX_BYTES) return 'too_large'
  if (!isSupportedMediaAssetContentType(input.contentType)) return 'unsupported_type'
  return hasValidMediaAssetSignature(input.contentType, input.signatureBytes) ? null : 'invalid_signature'
}

export function isEligibleWhatsAppMediaAsset(input: { contentType: string; byteSize: number }): boolean {
  if (input.contentType === 'application/pdf') {
    return input.byteSize > 0 && input.byteSize <= MEDIA_ASSET_MAX_BYTES
  }
  if (input.contentType === 'image/jpeg' || input.contentType === 'image/png') {
    return input.byteSize > 0 && input.byteSize <= WHATSAPP_IMAGE_MAX_BYTES
  }
  return false
}

function storageEnabled(): boolean {
  return REGION !== '' && BUCKET !== ''
}

function s3(): S3Client {
  if (!client) client = new S3Client({ region: REGION })
  return client
}

function safeSegment(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .join('/')
}

function timestamp(value = new Date()): string {
  return value.toISOString().replace(/[:.]/g, '-')
}

export function kbVaultEnabled(): boolean {
  return storageEnabled()
}

export function kbVaultBucketName(): string | null {
  return storageEnabled() ? BUCKET : null
}

export function kbUploadObjectKey(input: {
  clinicId: string
  documentId: string
  fileName: string
  createdAt?: Date
}): string {
  const name = safeSegment(input.fileName || 'knowledge-file')
  return `${PREFIX}/${input.clinicId}/kb/uploads/${input.documentId}/original/${timestamp(input.createdAt)}/${name}`
}

export function mediaObjectKey(input: { clinicId: string; assetId: string; fileName: string }): string {
  return `${PREFIX}/${safeSegment(input.clinicId)}/media/${safeSegment(input.assetId)}/${safeSegment(input.fileName || 'attachment')}`
}

export function kbGithubObjectKey(input: {
  clinicId: string
  commit: string
  relativePath: string
}): string {
  const commit = safeSegment(input.commit || 'unknown-commit')
  const relativePath = safeSegment(input.relativePath || 'knowledge.md')
  return `${PREFIX}/${input.clinicId}/kb/github/${commit}/${relativePath}`
}

export async function uploadKbVaultObject(input: {
  key: string
  body: Buffer | string | Readable
  contentType?: string
  metadata?: Record<string, string>
}): Promise<{ bucket: string; key: string } | null> {
  if (!storageEnabled()) return null
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType ?? 'application/octet-stream',
      Metadata: input.metadata,
      ServerSideEncryption: 'AES256',
    }),
  )
  return { bucket: BUCKET, key: input.key }
}

/** Delete only an object beneath this vault's configured prefix. S3 deletion is
 * idempotent, so this is safe for best-effort cleanup after a failed DB write. */
export async function deleteKbVaultObject(key: string): Promise<boolean> {
  if (!storageEnabled()) return false
  const normalizedKey = key.trim().replace(/^\/+/, '')
  if (normalizedKey === '' || !normalizedKey.startsWith(`${PREFIX}/`)) return false
  await s3().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: normalizedKey }))
  return true
}

export async function createKbVaultDownloadUrl(key: string, fileName?: string): Promise<string | null> {
  if (!storageEnabled() || key.trim() === '') return null
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: fileName
        ? `attachment; filename="${fileName.replace(/"/g, '')}"`
        : 'attachment',
    }),
    { expiresIn: 300 },
  )
}

/** Read a private object for a server-side provider upload. The storage key is
 * resolved from a clinic-scoped database row and is never returned to clients. */
export async function readKbVaultObject(key: string): Promise<Uint8Array | null> {
  if (!storageEnabled() || key.trim() === '') return null
  const result = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
  if (!result.Body) return null
  return result.Body.transformToByteArray()
}
