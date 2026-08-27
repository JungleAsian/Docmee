import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
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
