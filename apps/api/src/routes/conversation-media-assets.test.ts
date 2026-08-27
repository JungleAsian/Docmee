import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const BOUNDARY = '----docmeemediatestboundary'

const h = vi.hoisted(() => ({
  conversation: { id: 'conv-1', clinicId: 'clinic-1', channel: 'whatsapp', channelContactHandle: '15551234567', status: 'open', metadata: {} },
  asset: { id: 'asset-1', clinicId: 'clinic-1', filename: 'scan.png', contentType: 'image/png', byteSize: 8, storageKey: 'private/clinic-1/scan.png', storageStatus: 'active', deletedAt: null },
  findOutboundAttempt: vi.fn(),
  prepareOutbound: vi.fn(),
  markOutboundAccepted: vi.fn(),
  markOutboundUncertain: vi.fn(),
  reserveWithinQuota: vi.fn(),
  markUploadReady: vi.fn(),
  beginDeletion: vi.fn(),
  markDeletionComplete: vi.fn(),
  markDeletionFailed: vi.fn(),
  readObject: vi.fn(),
  uploadObject: vi.fn(),
  deleteObject: vi.fn(),
  uploadMedia: vi.fn(),
  sendImage: vi.fn(),
  sendDocument: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createConversationsRepository: () => ({ findById: async () => h.conversation }),
  createChannelAccountsRepository: () => ({ listByClinic: async () => [{ channel: 'whatsapp', status: 'active', accountId: 'phone-id', accessTokenEnc: 'provider-token' }] }),
  createErrorReviewsRepository: () => ({ create: vi.fn() }),
  createMediaAssetsRepository: () => ({
    findById: async (_clinicId: string, id: string) => id === h.asset.id ? h.asset : null,
    findOutboundAttempt: h.findOutboundAttempt,
    prepareOutbound: h.prepareOutbound,
    markOutboundAccepted: h.markOutboundAccepted,
    markOutboundUncertain: h.markOutboundUncertain,
    reserveWithinQuota: h.reserveWithinQuota,
    markUploadReady: h.markUploadReady,
    beginDeletion: h.beginDeletion,
    markDeletionComplete: h.markDeletionComplete,
    markDeletionFailed: h.markDeletionFailed,
  }),
}))
vi.mock('../lib/db.js', () => ({ withDb: async (callback: (sql: unknown) => unknown) => callback({}) }))
vi.mock('../lib/channel-send.js', () => ({
  uploadWhatsAppMedia: h.uploadMedia,
  sendWhatsAppImage: h.sendImage,
  sendWhatsAppDocument: h.sendDocument,
}))
vi.mock('../lib/kb-vault-storage.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/kb-vault-storage.js')>()
  return {
    ...actual,
    kbVaultEnabled: () => true,
    mediaObjectKey: () => 'private/clinic-1/direct.png',
    uploadKbVaultObject: h.uploadObject,
    deleteKbVaultObject: h.deleteObject,
    readKbVaultObject: h.readObject,
  }
})

import { signAccessToken } from '../auth/jwt.js'
import conversationMediaRoute from './conversation-media.js'

function multipartImage(bytes = PNG_BYTES) {
  return Buffer.concat([
    Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="direct.png"\r\nContent-Type: image/png\r\n\r\n`, 'utf8'),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf8'),
  ])
}

describe('conversation media send safety', () => {
  const auth = {
    authorization: `Bearer ${signAccessToken({ userId: 'staff-1', clinicId: 'clinic-1', role: 'secretary', email: 'staff@test.local' })}`,
    'idempotency-key': 'media-request-001',
  }
  const multipartAuth = { ...auth, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }
  const app = Fastify()

  beforeAll(async () => {
    await app.register(conversationMediaRoute)
    await app.ready()
  })
  afterAll(() => app.close())
  beforeEach(() => {
    vi.clearAllMocks()
    h.conversation = { ...h.conversation, status: 'open', metadata: {} }
    h.asset = { ...h.asset, filename: 'scan.png', contentType: 'image/png', byteSize: 8, storageKey: 'private/clinic-1/scan.png', storageStatus: 'active' }
    h.findOutboundAttempt.mockResolvedValue(null)
    h.prepareOutbound.mockResolvedValue({
      created: true,
      attempt: { id: 'attempt-1', status: 'sending', idempotencyKey: 'media-request-001', providerMessageId: null },
      message: { id: 'message-1', contentType: 'image', metadata: { providerStatus: 'sending' } },
      attachment: { id: 'attachment-1', providerStatus: 'pending' },
    })
    h.readObject.mockResolvedValue(PNG_BYTES)
    h.uploadObject.mockResolvedValue({ bucket: 'private', key: 'private/clinic-1/direct.png' })
    h.uploadMedia.mockResolvedValue('meta-media-1')
    h.sendImage.mockResolvedValue('wamid-1')
    h.sendDocument.mockResolvedValue('wamid-doc-1')
    h.reserveWithinQuota.mockResolvedValue({ ...h.asset, id: 'direct-asset', filename: 'direct.png', storageKey: 'private/clinic-1/direct.png', storageStatus: 'uploading' })
    h.markUploadReady.mockResolvedValue(undefined)
    h.beginDeletion.mockResolvedValue({ ...h.asset, id: 'direct-asset', storageKey: 'private/clinic-1/direct.png', storageStatus: 'delete_pending' })
    h.markDeletionComplete.mockResolvedValue(undefined)
    h.markDeletionFailed.mockResolvedValue(undefined)
    h.deleteObject.mockResolvedValue(true)
  })

  it('requires a client idempotency key before reading or sending media', async () => {
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: { authorization: auth.authorization }, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(400)
    expect(h.readObject).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('persists the idempotent attempt and handoff before calling Meta', async () => {
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1', caption: 'Results' } })

    expect(response.statusCode).toBe(201)
    expect(h.prepareOutbound).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-1', conversationId: 'conv-1', mediaAssetId: 'asset-1', idempotencyKey: 'media-request-001' }))
    expect(h.prepareOutbound.mock.invocationCallOrder[0]).toBeLessThan(h.uploadMedia.mock.invocationCallOrder[0]!)
    expect(h.markOutboundAccepted).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-1', attemptId: 'attempt-1', providerMessageId: 'wamid-1', providerMediaId: 'meta-media-1' }))
    expect(response.body).not.toContain('private/clinic-1')
    expect(response.body).not.toContain('provider-token')
  })

  it.each(['sending', 'uncertain', 'accepted'] as const)('returns an existing %s attempt without another provider call', async (status) => {
    h.findOutboundAttempt.mockResolvedValue({
      attempt: { id: 'attempt-existing', status, idempotencyKey: 'media-request-001', providerMessageId: status === 'accepted' ? 'wamid-existing' : null },
      message: { id: 'message-existing', channelMessageId: status === 'accepted' ? 'wamid-existing' : null, metadata: { providerStatus: status } },
      attachment: { id: 'attachment-existing', providerStatus: status },
    })

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(status === 'accepted' ? 200 : 202)
    expect(response.json().retryable).toBe(false)
    expect(h.prepareOutbound).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('marks an ambiguous provider exception uncertain and never returns a retry-send response', async () => {
    h.sendImage.mockRejectedValueOnce(new Error('provider timeout after possible acceptance'))

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ status: 'uncertain', retryable: false })
    expect(h.markOutboundUncertain).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-1', attemptId: 'attempt-1' }))
  })

  it('records reconciliation failure as uncertain instead of inviting a duplicate send', async () => {
    h.markOutboundAccepted.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ status: 'uncertain', retryable: false })
    expect(h.markOutboundUncertain).toHaveBeenCalledWith(expect.objectContaining({ attemptId: 'attempt-1', providerMessageId: 'wamid-1', providerMediaId: 'meta-media-1', failureCode: 'acceptance_reconciliation_failed' }))
  })

  it('sends an eligible PDF as a WhatsApp document', async () => {
    h.asset = { ...h.asset, filename: 'intake.pdf', contentType: 'application/pdf', byteSize: 5, storageKey: 'private/clinic-1/intake.pdf' }
    h.readObject.mockResolvedValue(new TextEncoder().encode('%PDF-'))

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(201)
    expect(h.sendDocument).toHaveBeenCalledWith('phone-id', 'provider-token', '15551234567', 'meta-media-1', 'intake.pdf', undefined)
    expect(h.sendImage).not.toHaveBeenCalled()
  })

  it.each([
    ['WebP', 'image/webp', 8],
    ['oversized image', 'image/png', 5 * 1024 * 1024 + 1],
  ])('rejects an ineligible selected %s before persistence or provider access', async (_label, contentType, byteSize) => {
    h.asset = { ...h.asset, contentType, byteSize }

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(400)
    expect(h.readObject).not.toHaveBeenCalled()
    expect(h.prepareOutbound).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('rejects selected media when the stored bytes do not match the recorded size', async () => {
    h.readObject.mockResolvedValue(new Uint8Array([...PNG_BYTES, 0]))

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(400)
    expect(h.prepareOutbound).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('reserves a direct-send asset before S3 and persists its attempt before Meta', async () => {
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media', headers: multipartAuth, payload: multipartImage() })

    expect(response.statusCode).toBe(201)
    expect(h.reserveWithinQuota).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-1', byteSize: 8, contentType: 'image/png' }), { maxFiles: 10, maxBytes: 100 * 1024 * 1024 })
    expect(h.reserveWithinQuota.mock.invocationCallOrder[0]).toBeLessThan(h.uploadObject.mock.invocationCallOrder[0]!)
    expect(h.markUploadReady.mock.invocationCallOrder[0]).toBeLessThan(h.prepareOutbound.mock.invocationCallOrder[0]!)
    expect(h.prepareOutbound.mock.invocationCallOrder[0]).toBeLessThan(h.uploadMedia.mock.invocationCallOrder[0]!)
  })

  it('rejects a direct image whose bytes do not match its declared type', async () => {
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media', headers: multipartAuth, payload: multipartImage(new TextEncoder().encode('not-png')) })

    expect(response.statusCode).toBe(400)
    expect(h.reserveWithinQuota).not.toHaveBeenCalled()
    expect(h.uploadObject).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('does not upload when direct-send quota reservation is rejected', async () => {
    h.reserveWithinQuota.mockRejectedValueOnce(new Error('media_file_limit_reached'))

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media', headers: multipartAuth, payload: multipartImage() })

    expect(response.statusCode).toBe(413)
    expect(h.uploadObject).not.toHaveBeenCalled()
    expect(h.prepareOutbound).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('cleans up a duplicate direct-send upload when a concurrent request already owns the key', async () => {
    h.prepareOutbound.mockResolvedValueOnce({
      created: false,
      attempt: { id: 'attempt-existing', status: 'sending', idempotencyKey: 'media-request-001', providerMessageId: null },
      message: { id: 'message-existing', channelMessageId: null, metadata: { providerStatus: 'sending' } },
      attachment: { id: 'attachment-existing', providerStatus: 'pending' },
    })

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media', headers: multipartAuth, payload: multipartImage() })

    expect(response.statusCode).toBe(202)
    expect(response.json()).toMatchObject({ attemptId: 'attempt-existing', retryable: false })
    expect(h.beginDeletion).toHaveBeenCalledWith('clinic-1', 'direct-asset')
    expect(h.deleteObject).toHaveBeenCalledWith('private/clinic-1/direct.png')
    expect(h.markDeletionComplete).toHaveBeenCalledWith('clinic-1', 'direct-asset')
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })
})
