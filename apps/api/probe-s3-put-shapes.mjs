import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

const region = process.env.DOCMEE_KB_S3_REGION || process.env.AWS_REGION || 'us-east-1'
const bucket = process.env.DOCMEE_KB_S3_BUCKET || process.env.S3_BUCKET_VOICE_NOTES || ''
const clinicId = '436840cd-66da-4511-ab66-0d63e8c83f91'
const key = `voice-notes/${clinicId}/kb/probe/iam-test-${Date.now()}.txt`

try {
  await new S3Client({ region }).send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: 'docmee kb vault probe',
      ContentType: 'text/plain; charset=utf-8',
      ServerSideEncryption: 'AES256',
    }),
  )
  console.log(JSON.stringify({ ok: true, keyShape: key.replace(clinicId, '{clinicId}') }, null, 2))
} catch (error) {
  console.log(JSON.stringify({ ok: false, name: error?.name, code: error?.Code }, null, 2))
  process.exit(1)
}
