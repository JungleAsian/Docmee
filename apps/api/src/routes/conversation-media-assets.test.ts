import Fastify from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  conversation: { id: 'conv-1', clinicId: 'clinic-1', channel: 'whatsapp', channelContactHandle: '15551234567', status: 'open', metadata: {} },
  asset: { id: 'asset-1', clinicId: 'clinic-1', filename: 'scan.png', contentType: 'image/png', byteSize: 8, storageKey: 'private/clinic-1/scan.png', deletedAt: null },
  createMessage: vi.fn(),
  attach: vi.fn(),
  updateConversation: vi.fn(),
  readObject: vi.fn(),
  uploadMedia: vi.fn(),
  sendImage: vi.fn(),
  sendDocument: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createConversationsRepository: () => ({ findById: async () => h.conversation, update: h.updateConversation }),
  createMessagesRepository: () => ({ create: h.createMessage }),
  createChannelAccountsRepository: () => ({ listByClinic: async () => [{ channel: 'whatsapp', status: 'active', accountId: 'phone-id', accessTokenEnc: 'provider-token' }] }),
  createErrorReviewsRepository: () => ({ create: vi.fn() }),
  createMediaAssetsRepository: () => ({ findById: async (_clinicId: string, id: string) => id === h.asset.id ? h.asset : null, attach: h.attach }),
}))
vi.mock('../lib/db.js', () => ({ withDb: async (callback: (sql: unknown) => unknown) => callback({}) }))
vi.mock('../lib/channel-send.js', () => ({
  uploadWhatsAppMedia: h.uploadMedia,
  sendWhatsAppImage: h.sendImage,
  sendWhatsAppDocument: h.sendDocument,
}))
vi.mock('../lib/kb-vault-storage.js', () => ({
  kbVaultEnabled: () => true,
  mediaObjectKey: vi.fn(),
  uploadKbVaultObject: vi.fn(),
  readKbVaultObject: h.readObject,
}))

import { signAccessToken } from '../auth/jwt.js'
import conversationMediaRoute from './conversation-media.js'

describe('stored media asset send route', () => {
  const auth = { authorization: `Bearer ${signAccessToken({ userId: 'staff-1', clinicId: 'clinic-1', role: 'secretary', email: 'staff@test.local' })}` }
  const app = Fastify()

  beforeAll(async () => {
    await app.register(conversationMediaRoute)
    await app.ready()
  })
  afterAll(() => app.close())
  beforeEach(() => {
    vi.clearAllMocks()
    h.asset = { ...h.asset, filename: 'scan.png', contentType: 'image/png', storageKey: 'private/clinic-1/scan.png' }
    h.readObject.mockResolvedValue(new Uint8Array([137, 80, 78, 71]))
    h.uploadMedia.mockResolvedValue('meta-media-1')
    h.sendImage.mockResolvedValue('wamid-1')
    h.sendDocument.mockResolvedValue('wamid-doc-1')
    h.createMessage.mockResolvedValue({ id: 'message-1', contentType: h.asset.contentType === 'application/pdf' ? 'document' : 'image' })
    h.attach.mockResolvedValue({ id: 'attachment-1' })
  })

  it('resolves an image by clinic-scoped asset id, sends it, records provenance, and pauses automation', async () => {
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1', caption: 'Results' } })

    expect(response.statusCode).toBe(201)
    expect(h.readObject).toHaveBeenCalledWith('private/clinic-1/scan.png')
    expect(h.uploadMedia).toHaveBeenCalledWith('phone-id', 'provider-token', expect.any(Uint8Array), 'image/png', 'scan.png')
    expect(h.sendImage).toHaveBeenCalledWith('phone-id', 'provider-token', '15551234567', 'meta-media-1', 'Results')
    expect(h.createMessage).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'image', channelMessageId: 'wamid-1' }))
    expect(h.attach).toHaveBeenCalledWith(expect.objectContaining({ mediaAssetId: 'asset-1', providerMessageId: 'wamid-1', providerStatus: 'accepted' }))
    expect(h.updateConversation).toHaveBeenCalledWith('clinic-1', 'conv-1', expect.objectContaining({ status: 'handoff' }))
    expect(response.body).not.toContain('private/clinic-1')
    expect(response.body).not.toContain('provider-token')
  })

  it('sends a PDF as a WhatsApp document', async () => {
    h.asset = { ...h.asset, filename: 'intake.pdf', contentType: 'application/pdf', storageKey: 'private/clinic-1/intake.pdf' }
    const response = await app.inject({ method: 'POST', url: '/conversations/conv-1/send-media-asset', headers: auth, payload: { assetId: 'asset-1' } })

    expect(response.statusCode).toBe(201)
    expect(h.sendDocument).toHaveBeenCalledWith('phone-id', 'provider-token', '15551234567', 'meta-media-1', 'intake.pdf', undefined)
    expect(h.sendImage).not.toHaveBeenCalled()
    expect(h.createMessage).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'document' }))
  })
})
