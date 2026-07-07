import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  sendWhatsAppText: vi.fn(),
  followUpAdd: vi.fn(),
  findClinic: vi.fn(),
  findPatient: vi.fn(),
  listContacts: vi.fn(),
  listByClinic: vi.fn(),
  findAppointment: vi.fn(),
  createIfAbsent: vi.fn(),
  markSent: vi.fn(),
  existsRecentByConversation: vi.fn(),
  countSentToPatientSince: vi.fn(),
  findLastInboundAt: vi.fn(),
  findApprovedByCategory: vi.fn(),
  convFindById: vi.fn(),
  convFindOpenByContact: vi.fn(),
  convCreate: vi.fn(),
  msgCreate: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/channels', () => ({ sendWhatsAppText: h.sendWhatsAppText }))

vi.mock('@docmee/queue', () => ({
  followUpQueue: { add: h.followUpAdd },
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createClinicsRepository: () => ({ findById: h.findClinic }),
  createPatientsRepository: () => ({ findById: h.findPatient, listContacts: h.listContacts }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listByClinic }),
  createAppointmentsRepository: () => ({ findById: h.findAppointment }),
  createFollowUpsRepository: () => ({
    createIfAbsent: h.createIfAbsent,
    markSent: h.markSent,
    existsRecentByConversation: h.existsRecentByConversation,
    countSentToPatientSince: h.countSentToPatientSince,
  }),
  createMessagesRepository: () => ({ findLastInboundAt: h.findLastInboundAt, create: h.msgCreate }),
  createConversationsRepository: () => ({
    findById: h.convFindById,
    findOpenByContact: h.convFindOpenByContact,
    create: h.convCreate,
  }),
  createMessageTemplatesRepository: () => ({ findApprovedByCategory: h.findApprovedByCategory }),
}))

import { processFollowUpJob, scheduleFollowUp, FOLLOW_UP_TYPES } from '../follow-up.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const PATIENT = '22222222-2222-2222-2222-222222222222'
const APPT = '33333333-3333-3333-3333-333333333333'
const CONVO = '44444444-4444-4444-4444-444444444444'

const makeJob = (data: unknown) => ({ data }) as never

const base = { clinicId: CLINIC, patientId: PATIENT, type: FOLLOW_UP_TYPES.CONFIRMATION, appointmentId: APPT }

beforeEach(() => {
  vi.clearAllMocks()
  h.findClinic.mockResolvedValue({ id: CLINIC, name: 'Clinic', timezone: 'UTC' })
  h.findPatient.mockResolvedValue({ id: PATIENT, metadata: {} })
  h.listContacts.mockResolvedValue([
    { channel: 'whatsapp', contactHandle: '50299998889', isPrimary: true },
  ])
  h.listByClinic.mockResolvedValue([
    { channel: 'whatsapp', status: 'active', accountId: 'PHONE_ID', accessTokenEnc: 'token' },
  ])
  h.findAppointment.mockResolvedValue({ id: APPT, status: 'confirmed', startTime: '2026-07-01T14:30:00.000Z' })
  h.createIfAbsent.mockResolvedValue({ id: 'fu-1' })
  h.existsRecentByConversation.mockResolvedValue(false)
  h.countSentToPatientSince.mockResolvedValue(0)
  // Within the 24h customer-care window by default (a recent inbound message).
  h.findLastInboundAt.mockResolvedValue(new Date().toISOString())
  h.findApprovedByCategory.mockResolvedValue(null)
  // The send returns the WhatsApp message id; persist it onto the inbox thread.
  h.sendWhatsAppText.mockResolvedValue('wamid.HBgL')
  h.convFindById.mockResolvedValue(null)
  h.convFindOpenByContact.mockResolvedValue({ id: CONVO })
  h.convCreate.mockResolvedValue({ id: 'new-convo' })
  h.msgCreate.mockResolvedValue({ id: 'msg-1' })
})

describe('processFollowUpJob', () => {
  it('sends a free-text confirmation inside the 24h window', async () => {
    await processFollowUpJob(makeJob(base))
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    const [phoneId, , to, text] = h.sendWhatsAppText.mock.calls[0]
    expect(phoneId).toBe('PHONE_ID')
    expect(to).toBe('50299998889')
    expect(text).toContain('cita') // Spanish default copy
    expect(h.createIfAbsent).toHaveBeenCalledTimes(1)
    expect(h.markSent).toHaveBeenCalledWith(CLINIC, 'fu-1')
  })

  describe('inbox visibility (Req 4/14)', () => {
    it('persists the sent follow-up onto the patient open WhatsApp thread', async () => {
      await processFollowUpJob(makeJob(base))
      expect(h.convFindOpenByContact).toHaveBeenCalledWith(CLINIC, 'whatsapp', '50299998889')
      expect(h.msgCreate).toHaveBeenCalledTimes(1)
      const row = h.msgCreate.mock.calls[0][0]
      expect(row.conversationId).toBe(CONVO)
      expect(row.role).toBe('assistant')
      expect(row.channelMessageId).toBe('wamid.HBgL') // wamid → Req 3 delivery indicator
      expect(row.metadata).toMatchObject({ channel: 'whatsapp', followUpType: FOLLOW_UP_TYPES.CONFIRMATION })
      expect(row.content).toContain('cita')
    })

    it('opens a new conversation when the patient has no open thread', async () => {
      h.convFindOpenByContact.mockResolvedValue(null)
      await processFollowUpJob(makeJob(base))
      expect(h.convCreate).toHaveBeenCalledWith({
        clinicId: CLINIC,
        patientId: PATIENT,
        channel: 'whatsapp',
        channelContactHandle: '50299998889',
      })
      expect(h.msgCreate.mock.calls[0][0].conversationId).toBe('new-convo')
    })

    it('threads a no_response nudge onto the conversation it belongs to', async () => {
      h.convFindById.mockResolvedValue({ id: CONVO })
      await processFollowUpJob(
        makeJob({
          clinicId: CLINIC,
          patientId: PATIENT,
          type: FOLLOW_UP_TYPES.NO_RESPONSE,
          conversationId: CONVO,
          silentSinceIso: new Date(Date.now() + 1000).toISOString(),
        }),
      )
      expect(h.convFindById).toHaveBeenCalledWith(CLINIC, CONVO)
      expect(h.convFindOpenByContact).not.toHaveBeenCalled()
      expect(h.msgCreate.mock.calls[0][0].conversationId).toBe(CONVO)
    })

    it('does not break the send when inbox persistence fails', async () => {
      h.msgCreate.mockRejectedValue(new Error('db down'))
      await processFollowUpJob(makeJob(base))
      expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
      expect(h.markSent).toHaveBeenCalledWith(CLINIC, 'fu-1')
    })
  })

  it('uses the English copy when the patient language is en', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, metadata: { language: 'en' } })
    await processFollowUpJob(makeJob({ ...base, type: FOLLOW_UP_TYPES.REVIEW_REQUEST, appointmentId: APPT }))
    const [, , , text] = h.sendWhatsAppText.mock.calls[0]
    expect(text).toContain('feedback')
  })

  it('NEVER messages an opted-out patient', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, metadata: { optedOut: true } })
    await processFollowUpJob(makeJob(base))
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  it('skips a follow-up for a cancelled appointment', async () => {
    h.findAppointment.mockResolvedValue({ id: APPT, status: 'cancelled', startTime: '2026-07-01T14:30:00.000Z' })
    await processFollowUpJob(makeJob(base))
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    expect(h.createIfAbsent).not.toHaveBeenCalled()
  })

  it('stays silent when the patient has no WhatsApp contact', async () => {
    h.listContacts.mockResolvedValue([])
    await processFollowUpJob(makeJob(base))
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  describe('per-clinic automation toggle (Screen 12)', () => {
    it('skips a type the clinic switched off', async () => {
      h.findClinic.mockResolvedValue({
        id: CLINIC,
        name: 'Clinic',
        timezone: 'UTC',
        settings: { automations: { followUps: { appointment_confirmation: false } } },
      })
      await processFollowUpJob(makeJob(base))
      expect(h.sendWhatsAppText).not.toHaveBeenCalled()
      expect(h.createIfAbsent).not.toHaveBeenCalled()
    })

    it('still sends a different type that stays enabled', async () => {
      h.findClinic.mockResolvedValue({
        id: CLINIC,
        name: 'Clinic',
        timezone: 'UTC',
        settings: { automations: { followUps: { seven_day: false } } },
      })
      await processFollowUpJob(makeJob(base)) // confirmation — not disabled
      expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    })
  })

  it('drops the job for an unknown clinic', async () => {
    h.findClinic.mockResolvedValue(null)
    await processFollowUpJob(makeJob(base))
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalled() // db connection always closed
  })

  it('does not double-send when the follow-up was already recorded', async () => {
    h.createIfAbsent.mockResolvedValue(null) // (appointment, type) already claimed
    await processFollowUpJob(makeJob(base))
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  describe('outbound anti-spam cap (Req 19)', () => {
    it('skips when the patient already hit the proactive cap', async () => {
      h.countSentToPatientSince.mockResolvedValue(5) // default cap is 5 / 24h
      await processFollowUpJob(makeJob(base))
      expect(h.sendWhatsAppText).not.toHaveBeenCalled()
      expect(h.createIfAbsent).not.toHaveBeenCalled()
      expect(h.countSentToPatientSince).toHaveBeenCalledWith(CLINIC, PATIENT, 24)
    })

    it('still sends when below the cap', async () => {
      h.countSentToPatientSince.mockResolvedValue(4)
      await processFollowUpJob(makeJob(base))
      expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    })
  })

  describe('24h customer-care window', () => {
    it('skips when outside the window and no approved template exists', async () => {
      h.findLastInboundAt.mockResolvedValue(null) // never wrote → outside window
      await processFollowUpJob(makeJob({ ...base, type: FOLLOW_UP_TYPES.POST_CONSULTATION }))
      expect(h.sendWhatsAppText).not.toHaveBeenCalled()
      expect(h.createIfAbsent).not.toHaveBeenCalled()
    })

    it('sends the approved template body when outside the window', async () => {
      h.findLastInboundAt.mockResolvedValue(null) // outside window
      h.findApprovedByCategory.mockResolvedValue({ id: 't1', body: 'APPROVED REMINDER BODY' })
      await processFollowUpJob(makeJob({ ...base, type: FOLLOW_UP_TYPES.REMINDER }))
      expect(h.findApprovedByCategory).toHaveBeenCalledWith(CLINIC, 'appointment_reminder')
      const [, , , text] = h.sendWhatsAppText.mock.calls[0]
      expect(text).toBe('APPROVED REMINDER BODY')
    })
  })

  describe('no_response', () => {
    const noResp = {
      clinicId: CLINIC,
      patientId: PATIENT,
      type: FOLLOW_UP_TYPES.NO_RESPONSE,
      conversationId: CONVO,
      silentSinceIso: '2026-06-19T10:00:00.000Z',
    }

    it('self-cancels when the patient replied after it was scheduled', async () => {
      h.findLastInboundAt.mockResolvedValue('2026-06-19T11:00:00.000Z') // replied later
      await processFollowUpJob(makeJob(noResp))
      expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    })

    it('dedupes a second nudge for the same conversation', async () => {
      h.findLastInboundAt.mockResolvedValue('2026-06-19T09:00:00.000Z') // before silentSince → still silent
      h.existsRecentByConversation.mockResolvedValue(true)
      await processFollowUpJob(makeJob(noResp))
      expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    })

    it('sends one nudge when still silent and not yet sent', async () => {
      // Inside the window (recent enough) but no reply after silentSince.
      h.findLastInboundAt.mockResolvedValue(new Date().toISOString())
      const recentSilent = { ...noResp, silentSinceIso: new Date(Date.now() + 1000).toISOString() }
      await processFollowUpJob(makeJob(recentSilent))
      expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
      const [, , , text] = h.sendWhatsAppText.mock.calls[0]
      expect(text).toContain('pendientes')
    })
  })

  it('scheduleFollowUp enqueues a delayed job', async () => {
    await scheduleFollowUp(base, 24 * 60 * 60 * 1000)
    expect(h.followUpAdd).toHaveBeenCalledWith('follow-up', base, { delay: 86_400_000 })
  })
})
