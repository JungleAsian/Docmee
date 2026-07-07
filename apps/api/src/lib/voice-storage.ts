import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const REGION = process.env['AWS_REGION']?.trim() || ''
const BUCKET = process.env['S3_BUCKET_VOICE_NOTES']?.trim() || ''

let client: S3Client | null = null

function enabled(): boolean {
  return REGION !== '' && BUCKET !== ''
}

function s3(): S3Client {
  if (!client) client = new S3Client({ region: REGION })
  return client
}

export async function createVoiceReviewAudioUrl(objectKey: string): Promise<string | null> {
  if (!enabled() || !objectKey) return null
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: objectKey,
      ResponseContentDisposition: 'inline',
    }),
    { expiresIn: 900 },
  )
}
