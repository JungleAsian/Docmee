import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const BOUNDARY = '----docmeemediatestboundary'

const h = vi.hoisted(() => ({
  conversation: { id: 'conv-1', clinicId: 'clinic-1', channel: 'whatsapp', channelContactHandle: '15551234567', status: 'open', metadata: {} },
  asset: { id: 'asset-1', clinicId: 'clinic-1', filename: 'scan.png', contentType: 'image/png', byteSize: 8, storageKey: 'private/clinic-1/scan.png', deletedAt: null },
  createMessage: vi.fn(),
  attach: vi.fn(),
  markOutboundAccepted: vi.fn(),
  markOutboundFailed: vi.fn(),
  createWithinQuota: vi.fn(),
  softDelete: vi.fn(),
  updateConversation: vi.fn(),
  readObject: vi.fn(),
  uploadObject: vi.fn(),
  deleteObject: vi.fn(),
  uploadMedia: vi.fn(),
  sendImage: vi.fn(),
  sendDocument: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createConversationsRepository: () => ({ findById: async () => h.conversation, update: h.updateConversation }),
  createMessagesRepository: () => ({
    create: h.createMessage,
  }),
  createChannelAccountsRepository: () => ({ listByClinic: async () => [{ channel: 'whatsapp', status: 'active', accountId: 'phone-id', accessTokenEnc: 'provider-token' }] }),
  createErrorReviewsRepository: () => ({ create: vi.fn() }),
  createMediaAssetsRepository: () => ({
    findById: async (_clinicId: string, id: string) => id === h.asset.id ? h.asset : null,
    createWithinQuota: h.createWithinQuota,
    softDelete: h.softDelete,
    attach: h.attach,
    markOutboundAccepted: h.markOutboundAccepted,
    markOutboundFailed: h.markOutboundFailed,
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

describe('conversation media send routes', () => {
  const auth = { authorization: `Bearer ${signAccessToken({ userId: 'staff-1', clinicId: 'clinic-1', role: 'secretary', email: 'staff@test.local' })}` }
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
    h.asset = { ...h.asset, filename: 'scan.png', contentType: 'image/png', byteSize: 8, storageKey: 'private/clinic-1/scan.png' }
    h.readObject.mockResolvedValue(PNG_BYTES)
    h.uploadObject.mockResolvedValue({ bucket: 'private', key: 'private/clinic-1/direct.png' })
    h.uploadMedia.mockResolvedValue('meta-media-1')
    h.sendImage.mockResolvedValue('wamid-1')
    h.sendDocument.mockResolvedValue('wamid-doc-1')
    h.createMessage.mockResolvedValue({ id: 'message-1', contentType: 'image', metadata: { providerStatus: 'pending' } })
    h.attach.mockResolvedValue({ id: 'attachment-1', providerStatus: 'pending' })
    h.createWithinQuota.mockResolvedValue({ ...h.asset, id: 'direct-asset', filename: 'direct.png', storageKey: 'private/clinic-1/direct.png' })
    h.softDelete.mockResolvedValue(true)
    h.deleteObject.mockResolvedValue(true)
  })

  it('persists a selected asset send as pending and pauses automation before calling Meta', async () => {
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1', caption: 'Results' } })

    expect(response.statusCode).toBe(201)
    expect(h.createMessage).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image', channelMessageId: undefined, metadata: expect.objectContaining({ providerStatus: 'pending' }) }))
    expect(h.attach).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetId: 'asset-1', providerMessageId: null, providerStatus: 'pending' }))
    expect(h.updateConversation).toHaveBeenCalledWith('clinic-1', 'conv-1', expect.objectContaining({ status: 'handoff' }))
    expect(h.createMessage.mock.invocationCallOrder[0]).toBeLessThan(h.uploadMedia.mock.invocationCallOrder[0]!)
    expect(h.attach.mock.invocationCallOrder[0]).toBeLessThan(h.uploadMedia.mock.invocationCallOrder[0]!)
    expect(h.updateConversation.mock.invocationCallOrder[0]).toBeLessThan(h.uploadMedia.mock.invocationCallOrder[0]!)
    expect(h.markOutboundAccepted).toHaveBeenCalledWith({ clinicId: 'clinic-1', messageId: 'message-1', attachmentId: 'attachment-1', providerMessageId: 'wamid-1', providerMediaId: 'meta-media-1' })
    expect(response.body).not.toContain('private/clinic-1')
    expect(response.body).not.toContain('provider-token')
  })

  it('keeps the selected pending record and marks it failed when Meta rejects the send', async () => {
    h.sendImage.mockRejectedValueOnce(new Error('Meta rejected media'))

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(502)
    expect(h.createMessage).toHaveBeenCalledOnce()
    expect(h.attach).toHaveBeenCalledOnce()
    expect(h.updateConversation).toHaveBeenCalledOnce()
    expect(h.markOutboundFailed).toHaveBeenCalledWith({ clinicId: 'clinic-1', messageId: 'message-1', attachmentId: 'attachment-1', failureCode: 'provider_send_failed' })
  })

  it('sends an eligible PDF as a WhatsApp document', async () => {
    h.asset = { ...h.asset, filename: 'intake.pdf', contentType: 'application/pdf', byteSize: 5, storageKey: 'private/clinic-1/intake.pdf' }
    h.readObject.mockResolvedValue(new TextEncoder().encode('%PDF-'))
    h.createMessage.mockResolvedValue({ id: 'message-1', contentType: 'document', metadata: { providerStatus: 'pending' } })

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
    expect(h.createMessage).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('rejects selected media when the stored bytes do not match the recorded size', async () => {
    h.readObject.mockResolvedValue(new Uint8Array([...PNG_BYTES, 0]))

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(400)
    expect(h.createMessage).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('stores a direct send within repository quota, persists pending state, and pauses before Meta', async () => {
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media', headers: multipartAuth, payload: multipartImage() })

    expect(response.statusCode).toBe(201)
    expect(h.createWithinQuota).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic-1', byteSize: 8, contentType: 'image/png' }), { maxFiles: 10, maxBytes: 100 * 1024 * 1024 })
    expect(h.attach).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetId: 'direct-asset', providerStatus: 'pending' }))
    expect(h.updateConversation.mock.invocationCallOrder[0]).toBeLessThan(h.uploadMedia.mock.invocationCallOrder[0]!)
    expect(h.markOutboundAccepted).toHaveBeenCalledWith({ clinicId: 'clinic-1', messageId: 'message-1', attachmentId: 'attachment-1', providerMessageId: 'wamid-1', providerMediaId: 'meta-media-1' })
  })

  it('rejects a direct image whose bytes do not match its declared type', async () => {
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media', headers: multipartAuth, payload: multipartImage(new TextEncoder().encode('not-png')) })

    expect(response.statusCode).toBe(400)
    expect(h.uploadObject).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })

  it('deletes a direct-send S3 object when the repository quota write fails', async () => {
    h.createWithinQuota.mockRejectedValueOnce(new Error('media_file_limit_reached'))

    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media', headers: multipartAuth, payload: multipartImage() })

    expect(response.statusCode).toBe(413)
    expect(h.deleteObject).toHaveBeenCalledWith('private/clinic-1/direct.png')
    expect(h.createMessage).not.toHaveBeenCalled()
    expect(h.uploadMedia).not.toHaveBeenCalled()
  })
})
