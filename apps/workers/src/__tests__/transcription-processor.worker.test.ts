import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  agentAdd: vi.fn(),
  downloadMedia: vi.fn(),
  transcribe: vi.fn(),
  sendWhatsAppText: vi.fn(),
  createErrorReview: vi.fn(),
  listByClinic: vi.fn(),
  findConversationById: vi.fn(),
  findOpenByContact: vi.fn(),
  createConversation: vi.fn(),
  createMessage: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/queue', () => ({
  agentQueue: { add: h.agentAdd },
}))

vi.mock('@docmee/channels', () => ({
  downloadMedia: h.downloadMedia,
  deepgramProvider: { transcribe: h.transcribe },
  sendWhatsAppText: h.sendWhatsAppText,
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createErrorReviewsRepository: () => ({ create: h.createErrorReview }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listByClinic }),
  createConversationsRepository: () => ({
    findById: h.findConversationById,
    findOpenByContact: h.findOpenByContact,
    create: h.createConversation,
  }),
  createMessagesRepository: () => ({ create: h.createMessage }),
}))

import { processTranscriptionJob } from '../transcription-processor.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const PATIENT = '22222222-2222-2222-2222-222222222222'
const CONVO = '33333333-3333-3333-3333-333333333333'

const makeJob = (data: unknown) => ({ data }) as never

const base = {
  clinicId: CLINIC,
  patientId: PATIENT,
  patientWaId: '50299998889',
  messageId: 'wamid.test002',
  mediaId: 'MEDIA_ID_001',
  mimeType: 'audio/ogg',
  waAccessToken: 'token',
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env['TRANSCRIPTION_RETRY_DELAY_MS'] = '0' // no real backoff in tests
  h.downloadMedia.mockResolvedValue({ buffer: new ArrayBuffer(8), mimeType: 'audio/ogg' })
  h.transcribe.mockResolvedValue({
    text: 'Hola quiero una cita.',
    language: 'es',
    duration_seconds: 3.2,
    confidence: 0.98,
    words: [],
  })
  h.listByClinic.mockResolvedValue([
    { channel: 'whatsapp', status: 'active', accountId: 'PHONE_ID', accessTokenEnc: 'token' },
  ])
  h.findConversationById.mockResolvedValue(null)
  h.findOpenByContact.mockResolvedValue(null)
  h.createConversation.mockResolvedValue({ id: CONVO })
})

describe('processTranscriptionJob', () => {
  it('transcribes a voice note and enqueues an agent job with the transcript', async () => {
    await processTranscriptionJob(makeJob(base))

    expect(h.downloadMedia).toHaveBeenCalledWith('MEDIA_ID_001', 'token')
    expect(h.transcribe).toHaveBeenCalledTimes(1)
    expect(h.agentAdd).toHaveBeenCalledTimes(1)
    const [, job] = h.agentAdd.mock.calls[0]
    expect(job.clinicId).toBe(CLINIC)
    expect(job.message).toBe('Hola quiero una cita.')
    expect(job.waMessageId).toBe('wamid.test002')
    expect(job.isVoiceNote).toBe(true)
    // No error path on success.
    expect(h.createErrorReview).not.toHaveBeenCalled()
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  it('stores the transcript as an audio message on a (new) conversation and threads it to the agent', async () => {
    await processTranscriptionJob(makeJob(base))

    // No existing thread → opens one on the WhatsApp contact handle.
    expect(h.findOpenByContact).toHaveBeenCalledWith(CLINIC, 'whatsapp', '50299998889')
    expect(h.createConversation).toHaveBeenCalledTimes(1)
    expect(h.createConversation.mock.calls[0][0]).toMatchObject({
      clinicId: CLINIC,
      patientId: PATIENT,
      channel: 'whatsapp',
      channelContactHandle: '50299998889',
    })

    // Voice note persisted with the transcript + audio marker.
    expect(h.createMessage).toHaveBeenCalledTimes(1)
    const msg = h.createMessage.mock.calls[0][0]
    expect(msg.conversationId).toBe(CONVO)
    expect(msg.role).toBe('user')
    expect(msg.contentType).toBe('audio')
    expect(msg.content).toBe('Hola quiero una cita.')
    expect(msg.transcription).toBe('Hola quiero una cita.')
    expect(msg.channelMessageId).toBe('wamid.test002')
    expect(msg.metadata.isVoiceNote).toBe(true)

    // Agent job is threaded onto the same conversation.
    const [, job] = h.agentAdd.mock.calls[0]
    expect(job.conversationId).toBe(CONVO)
  })

  it('reuses an existing open conversation instead of creating a new one', async () => {
    h.findOpenByContact.mockResolvedValue({ id: CONVO })
    await processTranscriptionJob(makeJob(base))

    expect(h.createConversation).not.toHaveBeenCalled()
    expect(h.createMessage.mock.calls[0][0].conversationId).toBe(CONVO)
    expect(h.agentAdd.mock.calls[0][1].conversationId).toBe(CONVO)
  })

  it('still enqueues the agent if persistence fails (never leaves the patient on read)', async () => {
    h.findOpenByContact.mockRejectedValue(new Error('db down'))
    await processTranscriptionJob(makeJob(base))

    expect(h.agentAdd).toHaveBeenCalledTimes(1)
    expect(h.agentAdd.mock.calls[0][1].message).toBe('Hola quiero una cita.')
    expect(h.agentAdd.mock.calls[0][1].conversationId).toBeUndefined()
  })

  it('retries 3 times then logs an error review and sends an apology', async () => {
    h.downloadMedia.mockRejectedValue(new Error('media 404'))

    await processTranscriptionJob(makeJob(base))

    expect(h.downloadMedia).toHaveBeenCalledTimes(3)
    expect(h.agentAdd).not.toHaveBeenCalled()
    expect(h.createErrorReview).toHaveBeenCalledTimes(1)
    const errArg = h.createErrorReview.mock.calls[0][0]
    expect(errArg.errorType).toBe('transcription_failure')
    expect(errArg.clinicId).toBe(CLINIC)
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    const [phoneNumberId, token, to, text] = h.sendWhatsAppText.mock.calls[0]
    expect(phoneNumberId).toBe('PHONE_ID')
    expect(token).toBe('token')
    expect(to).toBe('50299998889')
    expect(text).toMatch(/texto/)
    expect(h.end).toHaveBeenCalled()
  })

  it('succeeds on a later attempt after a transient failure', async () => {
    h.transcribe
      .mockRejectedValueOnce(new Error('deepgram timeout'))
      .mockResolvedValueOnce({
        text: 'segundo intento',
        language: 'es',
        duration_seconds: 2,
        confidence: 0.9,
        words: [],
      })

    await processTranscriptionJob(makeJob(base))

    expect(h.transcribe).toHaveBeenCalledTimes(2)
    expect(h.agentAdd).toHaveBeenCalledTimes(1)
    expect(h.createErrorReview).not.toHaveBeenCalled()
  })

  it('throws a ZodError on an invalid payload', async () => {
    await expect(processTranscriptionJob(makeJob({ foo: 'bar' }))).rejects.toThrow()
    expect(h.downloadMedia).not.toHaveBeenCalled()
  })
})
