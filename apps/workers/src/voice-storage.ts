import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'

type ReviewFieldMap = Record<string, string>

export interface VoiceReviewMarkdownEntry {
  reviewId: string
  createdAt: string
  transcript: string
  status: string
  confidence: string
  extractedFields: ReviewFieldMap
  notes?: string
  reviewerName?: string | null
}

const REGION = process.env['AWS_REGION']?.trim() || ''
const BUCKET = process.env['S3_BUCKET_VOICE_NOTES']?.trim() || ''

let client: S3Client | null = null

function storageEnabled(): boolean {
  return REGION !== '' && BUCKET !== ''
}

function s3(): S3Client {
  if (!client) client = new S3Client({ region: REGION })
  return client
}

export function voiceBucketName(): string | null {
  return storageEnabled() ? BUCKET : null
}

export function voiceObjectKey(input: {
  clinicId: string
  patientId?: string
  conversationId?: string
  messageId: string
  mimeType?: string
  createdAt: string
}): string {
  const ext = extensionForMimeType(input.mimeType)
  const patientId = input.patientId ?? 'unknown-patient'
  const conversationId = input.conversationId ?? 'unknown-conversation'
  const stamp = input.createdAt.replace(/[:.]/g, '-')
  return `voice-notes/${input.clinicId}/${patientId}/${conversationId}/${stamp}-${input.messageId}.${ext}`
}

export async function uploadVoiceNoteObject(input: {
  clinicId: string
  patientId?: string
  conversationId?: string
  messageId: string
  mimeType?: string
  createdAt: string
  buffer: Buffer
}): Promise<{ bucket: string; objectKey: string } | null> {
  if (!storageEnabled()) return null
  const objectKey = voiceObjectKey(input)
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
      Body: input.buffer,
      ContentType: input.mimeType ?? 'application/octet-stream',
      ServerSideEncryption: 'AES256',
    }),
  )
  return { bucket: BUCKET, objectKey }
}

export async function appendPatientHistoryEntry(input: {
  clinicId: string
  patientId: string
  patientName?: string | null
  entry: VoiceReviewMarkdownEntry
}): Promise<void> {
  if (!storageEnabled()) return
  const key = patientHistoryObjectKey(input.clinicId, input.patientId)
  const existing = await readUtf8IfExists(key)
  const next = existing + renderEntry(input.patientName ?? 'Unknown', input.entry, existing.length === 0)
  await s3().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: Buffer.from(next, 'utf8'),
      ContentType: 'text/markdown; charset=utf-8',
      ServerSideEncryption: 'AES256',
    }),
  )
}

function patientHistoryObjectKey(clinicId: string, patientId: string): string {
  return `patient-history/${clinicId}/${patientId}.md`
}

async function readUtf8IfExists(key: string): Promise<string> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: key }))
    return await bodyToString(res.Body)
  } catch (err) {
    const code = (err as { name?: string }).name
    if (code === 'NoSuchKey' || code === 'NotFound') return ''
    throw err
  }
}

async function bodyToString(body: unknown): Promise<string> {
  if (!body || typeof body !== 'object' || !('transformToString' in body)) return ''
  const fn = (body as { transformToString: (encoding?: string) => Promise<string> }).transformToString
  return fn('utf8')
}

function renderEntry(patientName: string, entry: VoiceReviewMarkdownEntry, includeHeader: boolean): string {
  const lines: string[] = []
  if (includeHeader) {
    lines.push('# Patient Booking History')
    lines.push(`Patient Name: ${patientName}`)
    lines.push('')
  }
  lines.push(`## ${entry.createdAt}`)
  lines.push(`Review ID: ${entry.reviewId}`)
  lines.push('Source: WhatsApp voice note')
  lines.push(`Status: ${entry.status}`)
  lines.push(`Confidence: ${entry.confidence}`)
  lines.push(`Transcript: ${quoteLine(entry.transcript)}`)
  lines.push('Extracted:')
  if (Object.keys(entry.extractedFields).length === 0) {
    lines.push('- none')
  } else {
    for (const [key, value] of Object.entries(entry.extractedFields)) {
      lines.push(`- ${key}: ${value}`)
    }
  }
  if (entry.notes?.trim()) lines.push(`Notes: ${entry.notes.trim()}`)
  if (entry.reviewerName?.trim()) lines.push(`Reviewer: ${entry.reviewerName.trim()}`)
  lines.push('')
  return lines.join('\n')
}

function extensionForMimeType(mimeType?: string): string {
  switch (mimeType) {
    case 'audio/ogg':
      return 'ogg'
    case 'audio/mpeg':
      return 'mp3'
    case 'audio/mp4':
      return 'm4a'
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav'
    default:
      return 'bin'
  }
}

function quoteLine(value: string): string {
  return `"${value.replace(/\s+/g, ' ').trim()}"`
}
