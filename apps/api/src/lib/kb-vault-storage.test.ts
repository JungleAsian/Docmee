import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const s3Send = vi.hoisted(() => vi.fn(async (_command: { input: Record<string, unknown> }) => ({})))
const originalEnv = {
  bucket: process.env['S3_BUCKET_KB'],
  region: process.env['S3_BUCKET_KB_REGION'],
  prefix: process.env['DOCMEE_KB_S3_PREFIX'],
}

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  return {
    DeleteObjectCommand: Command,
    GetObjectCommand: Command,
    PutObjectCommand: Command,
    S3Client: class {
      send = s3Send
    },
  }
})

describe('KB vault object deletion', () => {
  beforeEach(() => {
    vi.resetModules()
    s3Send.mockClear()
    process.env['S3_BUCKET_KB'] = 'private-media'
    process.env['S3_BUCKET_KB_REGION'] = 'us-east-1'
    process.env['DOCMEE_KB_S3_PREFIX'] = 'voice-notes'
  })

  afterEach(() => {
    if (originalEnv.bucket === undefined) delete process.env['S3_BUCKET_KB']
    else process.env['S3_BUCKET_KB'] = originalEnv.bucket
    if (originalEnv.region === undefined) delete process.env['S3_BUCKET_KB_REGION']
    else process.env['S3_BUCKET_KB_REGION'] = originalEnv.region
    if (originalEnv.prefix === undefined) delete process.env['DOCMEE_KB_S3_PREFIX']
    else process.env['DOCMEE_KB_S3_PREFIX'] = originalEnv.prefix
  })

  it('refuses to delete a key outside the configured vault prefix', async () => {
    const { deleteKbVaultObject } = await import('./kb-vault-storage.js')

    await expect(deleteKbVaultObject('other-clinic/object.png')).resolves.toBe(false)
    expect(s3Send).not.toHaveBeenCalled()
  })

  it('deletes a key beneath the configured vault prefix', async () => {
    const { deleteKbVaultObject } = await import('./kb-vault-storage.js')

    await expect(deleteKbVaultObject('/voice-notes/clinic-1/object.png')).resolves.toBe(true)
    expect(s3Send).toHaveBeenCalledOnce()
    expect(s3Send.mock.calls[0]![0].input).toEqual({
      Bucket: 'private-media',
      Key: 'voice-notes/clinic-1/object.png',
    })
  })
})
