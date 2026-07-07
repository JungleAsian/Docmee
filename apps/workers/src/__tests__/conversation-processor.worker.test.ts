import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  transcriptionAdd: vi.fn(),
  agentAdd: vi.fn(),
  notificationAdd: vi.fn(),
  findByAccount: vi.fn(),
  findByMessengerPageId: vi.fn(),
  findByInstagramAccountId: vi.fn(),
  findClinicById: vi.fn(),
  findByContact: vi.fn(),
  createPatient: vi.fn(),
  addContact: vi.fn(),
  updatePatient: vi.fn(),
  findOpenByContact: vi.fn(),
  createConversation: vi.fn(),
  createMessage: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/queue', () => ({
  transcriptionQueue: { add: h.transcriptionAdd },
  agentQueue: { add: h.agentAdd },
  notificationQueue: { add: h.notificationAdd },
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createChannelAccountsRepository: () => ({ findByAccount: h.findByAccount }),
  createClinicsRepository: () => ({
    findByMessengerPageId: h.findByMessengerPageId,
    findByInstagramAccountId: h.findByInstagramAccountId,
    findById: h.findClinicById,
  }),
  createPatientsRepository: () => ({
    findByContact: h.findByContact,
    create: h.createPatient,
    addContact: h.addContact,
    update: h.updatePatient,
  }),
  createConversationsRepository: () => ({
    findOpenByContact: h.findOpenByContact,
    create: h.createConversation,
  }),
  createMessagesRepository: () => ({ create: h.createMessage }),
}))

import { processConversationJob } from '../conversation-processor.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const PATIENT = '22222222-2222-2222-2222-222222222222'
const CONVO = '44444444-4444-4444-4444-444444444444'

const makeJob = (data: unknown) => ({ data }) as never

const base = {
  phoneNumberId: 'PHONE_ID',
  patientWaId: '5215555555555',
  patientName: 'Ana',
  waMessageId: 'wamid.ABC',
  timestamp: 1700000000000,
}

const activeAccount = { clinicId: CLINIC, accessTokenEnc: 'token', settings: {} }

beforeEach(() => {
  vi.clearAllMocks()
  h.findByAccount.mockResolvedValue(activeAccount)
  h.findByMessengerPageId.mockResolvedValue({ id: CLINIC, settings: {} })
  h.findByInstagramAccountId.mockResolvedValue({ id: CLINIC, settings: {} })
  // No CRM (googleSheets) configured by default → contact export is skipped cleanly.
  h.findClinicById.mockResolvedValue({ id: CLINIC, name: 'Clinica', settings: {} })
  h.findByContact.mockResolvedValue({ id: PATIENT, status: 'returning' })
  h.createPatient.mockResolvedValue({ id: PATIENT, status: 'new' })
  h.findOpenByContact.mockResolvedValue(null)
  h.createConversation.mockResolvedValue({ id: CONVO })
  h.createMessage.mockResolvedValue({ id: 'msg1' })
})

describe('processConversationJob', () => {
  it('audio message → transcription queue', async () => {
    await processConversationJob(makeJob({ ...base, messageType: 'audio', mediaId: 'media1', mimeType: 'audio/ogg' }))
    expect(h.transcriptionAdd).toHaveBeenCalledTimes(1)
    expect(h.agentAdd).not.toHaveBeenCalled()
    const [, job] = h.transcriptionAdd.mock.calls[0]
    expect(job.clinicId).toBe(CLINIC)
    expect(job.waAccessToken).toBe('token')
  })

  it('text message → agent queue with resolved clinic', async () => {
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola' }))
    expect(h.agentAdd).toHaveBeenCalledTimes(1)
    expect(h.transcriptionAdd).not.toHaveBeenCalled()
    const [, job] = h.agentAdd.mock.calls[0]
    expect(job.clinicId).toBe(CLINIC)
    expect(job.message).toBe('hola')
    expect(job.isNewPatient).toBe(false)
  })

  it('text message → persists an inbound user message and threads the conversation (Req 4)', async () => {
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola' }))

    // A fresh conversation is created (none was open) and the inbound text is
    // persisted as a `user` message carrying the wamid.
    expect(h.createConversation).toHaveBeenCalledTimes(1)
    const [convInput] = h.createConversation.mock.calls[0]
    expect(convInput).toMatchObject({ clinicId: CLINIC, channel: 'whatsapp', channelContactHandle: base.patientWaId })

    expect(h.createMessage).toHaveBeenCalledTimes(1)
    const [msgInput] = h.createMessage.mock.calls[0]
    expect(msgInput).toMatchObject({
      conversationId: CONVO,
      clinicId: CLINIC,
      role: 'user',
      content: 'hola',
      contentType: 'text',
      channelMessageId: base.waMessageId,
    })

    // The agent job is threaded onto that same conversation.
    const [, job] = h.agentAdd.mock.calls[0]
    expect(job.conversationId).toBe(CONVO)
  })

  it('reuses the open conversation instead of creating a duplicate', async () => {
    h.findOpenByContact.mockResolvedValue({ id: CONVO })
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola otra vez' }))

    expect(h.createConversation).not.toHaveBeenCalled()
    expect(h.createMessage).toHaveBeenCalledTimes(1)
    const [, job] = h.agentAdd.mock.calls[0]
    expect(job.conversationId).toBe(CONVO)
  })

  it('inbound persistence failure → still enqueues the agent without a conversation id', async () => {
    h.createConversation.mockRejectedValue(new Error('db down'))
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola' }))

    expect(h.agentAdd).toHaveBeenCalledTimes(1)
    const [, job] = h.agentAdd.mock.calls[0]
    expect(job.conversationId).toBeUndefined()
    expect(job.message).toBe('hola')
  })

  it('audio message does NOT persist here (handled by the transcription worker)', async () => {
    await processConversationJob(
      makeJob({ ...base, messageType: 'audio', mediaId: 'media1', mimeType: 'audio/ogg' }),
    )
    expect(h.createConversation).not.toHaveBeenCalled()
    expect(h.createMessage).not.toHaveBeenCalled()
  })

  it('unknown phone_number_id → drops the message, no routing', async () => {
    h.findByAccount.mockResolvedValue(null)
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola' }))
    expect(h.agentAdd).not.toHaveBeenCalled()
    expect(h.transcriptionAdd).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalled()
  })

  it('new patient → creates patient + contact and flags isNewPatient', async () => {
    h.findByContact.mockResolvedValue(null)
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola' }))
    expect(h.createPatient).toHaveBeenCalledTimes(1)
    expect(h.addContact).toHaveBeenCalledTimes(1)
    const [, job] = h.agentAdd.mock.calls[0]
    expect(job.isNewPatient).toBe(true)
    expect(job.patientId).toBe(PATIENT)
  })

  it('Req 10: new WhatsApp patient captures name, phone and source on first contact', async () => {
    h.findByContact.mockResolvedValue(null)
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola' }))
    const [createInput] = h.createPatient.mock.calls[0]
    expect(createInput).toMatchObject({
      clinicId: CLINIC,
      fullName: 'Ana',
      status: 'new',
      metadata: { source: 'whatsapp', phone: base.patientWaId, contactHandle: base.patientWaId },
    })
  })

  it('Req 10: new Messenger patient captures source but not phone (handle is a PSID)', async () => {
    h.findByContact.mockResolvedValue(null)
    await processConversationJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'PAGE_ID',
        patientWaId: 'PSID_123',
        patientName: 'Bob',
        waMessageId: 'mid.ABC',
        timestamp: 1700000000000,
        messageType: 'text',
        content: 'hola',
      }),
    )
    const [createInput] = h.createPatient.mock.calls[0]
    expect(createInput.metadata).toMatchObject({ source: 'messenger', contactHandle: 'PSID_123' })
    expect(createInput.metadata.phone).toBeUndefined()
  })

  it('expiring Meta token → enqueues a notification', async () => {
    const soon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    h.findByAccount.mockResolvedValue({ ...activeAccount, settings: { tokenExpiresAt: soon } })
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola' }))
    expect(h.notificationAdd).toHaveBeenCalledTimes(1)
    const [, job] = h.notificationAdd.mock.calls[0]
    expect(job.type).toBe('META_TOKEN_EXPIRING')
    expect(job.channel).toBe('whatsapp')
  })

  it('WhatsApp token not near expiry → no notification', async () => {
    const far = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    h.findByAccount.mockResolvedValue({ ...activeAccount, settings: { tokenExpiresAt: far } })
    await processConversationJob(makeJob({ ...base, messageType: 'text', content: 'hola' }))
    expect(h.notificationAdd).not.toHaveBeenCalled()
  })

  it('Req 19: expiring Messenger token → enqueues a notification tagged messenger', async () => {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    h.findByMessengerPageId.mockResolvedValue({
      id: CLINIC,
      settings: { messengerTokenExpiresAt: soon },
    })
    await processConversationJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'PAGE_ID',
        patientWaId: 'PSID_123',
        waMessageId: 'mid.ABC',
        timestamp: 1700000000000,
        messageType: 'text',
        content: 'hola',
      }),
    )
    expect(h.notificationAdd).toHaveBeenCalledTimes(1)
    const [, job] = h.notificationAdd.mock.calls[0]
    expect(job.type).toBe('META_TOKEN_EXPIRING')
    expect(job.channel).toBe('messenger')
  })

  it('Req 19: Messenger token with no expiry configured → no notification', async () => {
    await processConversationJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'PAGE_ID',
        patientWaId: 'PSID_123',
        waMessageId: 'mid.ABC',
        timestamp: 1700000000000,
        messageType: 'text',
        content: 'hola',
      }),
    )
    expect(h.notificationAdd).not.toHaveBeenCalled()
  })

  it('Req 19: expiring Instagram token → enqueues a notification tagged instagram', async () => {
    const soon = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString()
    h.findByInstagramAccountId.mockResolvedValue({
      id: CLINIC,
      settings: { instagramTokenExpiresAt: soon },
    })
    await processConversationJob(
      makeJob({
        channel: 'instagram',
        phoneNumberId: 'IG_ACCOUNT',
        patientWaId: 'IGSID_123',
        waMessageId: 'mid.IG',
        timestamp: 1700000000000,
        messageType: 'text',
        content: 'hola',
      }),
    )
    expect(h.findByInstagramAccountId).toHaveBeenCalledWith('IG_ACCOUNT')
    expect(h.notificationAdd).toHaveBeenCalledTimes(1)
    const [, job] = h.notificationAdd.mock.calls[0]
    expect(job.type).toBe('META_TOKEN_EXPIRING')
    expect(job.channel).toBe('instagram')
  })

  it('invalid payload → throws ZodError', async () => {
    await expect(processConversationJob(makeJob({ foo: 'bar' }))).rejects.toThrow()
  })

  it('messenger text → resolves clinic by page id, enqueues with channel', async () => {
    await processConversationJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'PAGE_ID',
        patientWaId: 'PSID_123',
        waMessageId: 'mid.ABC',
        timestamp: 1700000000000,
        messageType: 'text',
        content: 'hola',
      }),
    )
    expect(h.findByMessengerPageId).toHaveBeenCalledWith('PAGE_ID')
    expect(h.findByAccount).not.toHaveBeenCalled()
    expect(h.agentAdd).toHaveBeenCalledTimes(1)
    const [, job] = h.agentAdd.mock.calls[0]
    expect(job.clinicId).toBe(CLINIC)
    expect(job.channel).toBe('messenger')
    expect(job.message).toBe('hola')
  })

  it('messenger with no enabled clinic → drops the message', async () => {
    h.findByMessengerPageId.mockResolvedValue(null)
    await processConversationJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'PAGE_ID',
        patientWaId: 'PSID_123',
        waMessageId: 'mid.ABC',
        timestamp: 1700000000000,
        messageType: 'text',
        content: 'hola',
      }),
    )
    expect(h.agentAdd).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalled()
  })
})
