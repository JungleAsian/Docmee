import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const BOUNDARY = '----docmeeassettestboundary'
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const h = vi.hoisted(() => ({
  createWithinQuota: vi.fn(),
  uploadObject: vi.fn(),
  deleteObject: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createMediaAssetsRepository: () => ({ createWithinQuota: h.createWithinQuota }),
}))
vi.mock('../lib/db.js', () => ({ withDb: async (callback: (sql: unknown) => unknown) => callback({}) }))
vi.mock('../lib/kb-vault-storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/kb-vault-storage.js')>()
  return {
    ...actual,
    kbVaultEnabled: () => true,
    mediaObjectKey: () => 'private/clinic-1/repository.png',
    uploadKbVaultObject: h.uploadObject,
    deleteKbVaultObject: h.deleteObject,
  }
})

import { signAccessToken } from '../auth/jwt.js'
import mediaAssetsRoute from './media-assets.js'

function multipartFile(bytes = PNG_BYTES) {
  return Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="repository.png"\r\nContent-Type: image/png\r\n\r\n`, 'utf8'),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf8'),
  ])
}

describe('media asset repository upload', () => {
  const app = Fastify()
  const headers = {
    authorization: `Bearer ${signAccessToken({ userId: 'staff-1', clinicId: 'clinic-1', role: 'secretary', email: 'staff@test.local' })}`,
    'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
  }

  beforeAll(async () => {
    await app.register(mediaAssetsRoute)
    await app.ready()
  })
  afterAll(() => app.close())
  beforeEach(() => {
    vi.clearAllMocks()
    h.uploadObject.mockResolvedValue({ bucket: 'private', key: 'private/clinic-1/repository.png' })
    h.deleteObject.mockResolvedValue(true)
  })

  it('removes the uploaded S3 object when the atomic quota insert rejects it', async () => {
    h.createWithinQuota.mockRejectedValueOnce(new Error('media_quota_exceeded'))

    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media', headers, payload: multipartFile() })

    expect(response.statusCode).toBe(413)
    expect(h.uploadObject).toHaveBeenCalledOnce()
    expect(h.deleteObject).toHaveBeenCalledWith('private/clinic-1/repository.png')
  })

  it('rejects a mismatched signature before uploading to S3 or writing the database', async () => {
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media', headers, payload: multipartFile(new TextEncoder().encode('not-png')) })

    expect(response.statusCode).toBe(400)
    expect(h.uploadObject).not.toHaveBeenCalled()
    expect(h.createWithinQuota).not.toHaveBeenCalled()
  })
})
