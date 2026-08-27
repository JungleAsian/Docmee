import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const BOUNDARY = '----docmeeassettestboundary'
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

const h = vi.hoisted(() => ({
  reserveWithinQuota: vi.fn(),
  markUploadReady: vi.fn(),
  beginDeletion: vi.fn(),
  markDeletionComplete: vi.fn(),
  markDeletionFailed: vi.fn(),
  findById: vi.fn(),
  uploadObject: vi.fn(),
  deleteObject: vi.fn(),
  downloadUrl: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createMediaAssetsRepository: () => ({ reserveWithinQuota: h.reserveWithinQuota, markUploadReady: h.markUploadReady, beginDeletion: h.beginDeletion, markDeletionComplete: h.markDeletionComplete, markDeletionFailed: h.markDeletionFailed, findById: h.findById }),
}))
vi.mock('../lib/db.js', () => ({ withDb: async (callback: (sql: unknown) => unknown) => callback({}) }))
vi.mock('../lib/kb-vault-storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/kb-vault-storage.js')>()
  return { ...actual, kbVaultEnabled: () => true, mediaObjectKey: () => 'private/clinic-1/repository.png', uploadKbVaultObject: h.uploadObject, deleteKbVaultObject: h.deleteObject, createKbVaultDownloadUrl: h.downloadUrl }
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

describe('media asset storage lifecycle', () => {
  const auth = { authorization: `Bearer ${signAccessToken({ userId: 'admin-1', clinicId: 'clinic-1', role: 'clinic_admin', email: 'admin@test.local' })}` }
  const multipartAuth = { ...auth, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }
  const app = Fastify()

  beforeAll(async () => { await app.register(mediaAssetsRoute); await app.ready() })
  afterAll(() => app.close())
  beforeEach(() => {
    vi.clearAllMocks()
    h.reserveWithinQuota.mockResolvedValue({ id: 'asset-1', clinicId: 'clinic-1', filename: 'repository.png', contentType: 'image/png', byteSize: 8, storageKey: 'private/clinic-1/repository.png', storageStatus: 'uploading', createdAt: '2026-08-27T00:00:00.000Z' })
    h.markUploadReady.mockResolvedValue(undefined)
    h.beginDeletion.mockResolvedValue({ id: 'asset-1', storageKey: 'private/clinic-1/repository.png', storageStatus: 'delete_pending' })
    h.markDeletionComplete.mockResolvedValue(undefined)
    h.markDeletionFailed.mockResolvedValue(undefined)
    h.findById.mockResolvedValue({ id: 'asset-1', clinicId: 'clinic-1', filename: 'repository.png', contentType: 'image/png', byteSize: 8, storageKey: 'private/clinic-1/repository.png', storageStatus: 'active', deletedAt: null, createdAt: '2026-08-27T00:00:00.000Z' })
    h.uploadObject.mockResolvedValue({ bucket: 'private', key: 'private/clinic-1/repository.png' })
    h.deleteObject.mockResolvedValue(true)
    h.downloadUrl.mockResolvedValue('https://example.test/signed')
  })

  it('reserves quota before uploading and activates only after S3 succeeds', async () => {
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media', headers: multipartAuth, payload: multipartFile() })

    expect(response.statusCode).toBe(201)
    expect(h.reserveWithinQuota.mock.invocationCallOrder[0]).toBeLessThan(h.uploadObject.mock.invocationCallOrder[0]!)
    expect(h.uploadObject.mock.invocationCallOrder[0]).toBeLessThan(h.markUploadReady.mock.invocationCallOrder[0]!)
  })

  it('physically deletes S3 before marking the durable deletion complete', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/clinics/clinic-1/media/asset-1', headers: auth })

    expect(response.statusCode).toBe(204)
    expect(h.beginDeletion).toHaveBeenCalledWith('clinic-1', 'asset-1')
    expect(h.deleteObject).toHaveBeenCalledWith('private/clinic-1/repository.png')
    expect(h.deleteObject.mock.invocationCallOrder[0]).toBeLessThan(h.markDeletionComplete.mock.invocationCallOrder[0]!)
  })

  it('keeps failed S3 cleanup durable and retryable instead of releasing quota', async () => {
    h.deleteObject.mockRejectedValueOnce(new Error('S3 unavailable'))

    const response = await app.inject({ method: 'DELETE', url: '/clinics/clinic-1/media/asset-1', headers: auth })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toMatchObject({ error: 'Media cleanup pending', retryable: true })
    expect(h.markDeletionComplete).not.toHaveBeenCalled()
    expect(h.markDeletionFailed).toHaveBeenCalledWith('clinic-1', 'asset-1', 's3_delete_failed')
  })

  it('does not issue download URLs for assets that are not fully active', async () => {
    h.findById.mockResolvedValueOnce({ id: 'asset-1', clinicId: 'clinic-1', filename: 'repository.png', storageKey: 'private/clinic-1/repository.png', storageStatus: 'delete_failed', deletedAt: null })

    const response = await app.inject({ method: 'GET', url: '/clinics/clinic-1/media/asset-1/download', headers: auth })

    expect(response.statusCode).toBe(404)
    expect(h.downloadUrl).not.toHaveBeenCalled()
  })

  it('rejects a mismatched signature before reserving quota or uploading', async () => {
    const response = await app.inject({ method: 'POST', url: '/clinics/clinic-1/media', headers: multipartAuth, payload: multipartFile(new TextEncoder().encode('not-png')) })

    expect(response.statusCode).toBe(400)
    expect(h.reserveWithinQuota).not.toHaveBeenCalled()
    expect(h.uploadObject).not.toHaveBeenCalled()
  })
})
