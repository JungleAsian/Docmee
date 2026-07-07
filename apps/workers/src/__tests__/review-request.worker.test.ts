import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  sendWhatsAppText: vi.fn(),
  listClinics: vi.fn(),
  listCompletedForReview: vi.fn(),
  listDoctors: vi.fn(),
  findPatient: vi.fn(),
  listContacts: vi.fn(),
  listAccounts: vi.fn(),
  createIfAbsent: vi.fn(),
  markSent: vi.fn(),
  findLastInboundAt: vi.fn(),
  findApprovedByCategory: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/channels', () => ({ sendWhatsAppText: h.sendWhatsAppText }))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createClinicsRepository: () => ({ list: h.listClinics }),
  createAppointmentsRepository: () => ({ listCompletedForReview: h.listCompletedForReview }),
  createDoctorsRepository: () => ({ listByClinic: h.listDoctors }),
  createPatientsRepository: () => ({ findById: h.findPatient, listContacts: h.listContacts }),
  createChannelAccountsRepository: () => ({ listByClinic: h.listAccounts }),
  createFollowUpsRepository: () => ({ createIfAbsent: h.createIfAbsent, markSent: h.markSent }),
  createMessagesRepository: () => ({ findLastInboundAt: h.findLastInboundAt }),
  createMessageTemplatesRepository: () => ({ findApprovedByCategory: h.findApprovedByCategory }),
}))

import { processReviewRequestJob } from '../review-request.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const PATIENT = '22222222-2222-2222-2222-222222222222'
const APPT = '33333333-3333-3333-3333-333333333333'
const DOCTOR = '44444444-4444-4444-4444-444444444444'

const makeJob = () => ({ data: {} }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.listClinics.mockResolvedValue([
    { id: CLINIC, status: 'active', settings: { reviewLink: 'https://g.page/clinic/review' } },
  ])
  h.listCompletedForReview.mockResolvedValue([
    { id: APPT, patientId: PATIENT, doctorId: DOCTOR },
  ])
  h.listAccounts.mockResolvedValue([
    { channel: 'whatsapp', status: 'active', accountId: 'PHONE_ID', accessTokenEnc: 'token' },
  ])
  h.listDoctors.mockResolvedValue([{ id: DOCTOR, name: 'Dr. Ruiz' }])
  h.findPatient.mockResolvedValue({ id: PATIENT, metadata: {} })
  h.listContacts.mockResolvedValue([
    { channel: 'whatsapp', contactHandle: '50299998889', isPrimary: true },
  ])
  h.createIfAbsent.mockResolvedValue({ id: 'fu-1' })
  // Default: inside the 24h window (a recent inbound message).
  h.findLastInboundAt.mockResolvedValue(new Date().toISOString())
  h.findApprovedByCategory.mockResolvedValue(null)
})

describe('processReviewRequestJob', () => {
  it('sends a free-text review invite when inside the 24h window', async () => {
    await processReviewRequestJob(makeJob())
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    const [phoneId, , to, text] = h.sendWhatsAppText.mock.calls[0]
    expect(phoneId).toBe('PHONE_ID')
    expect(to).toBe('50299998889')
    expect(text).toContain('Dr. Ruiz') // doctor name woven in
    expect(text).toContain('opinión') // Spanish default copy
    expect(h.findApprovedByCategory).not.toHaveBeenCalled()
    expect(h.markSent).toHaveBeenCalledWith(CLINIC, 'fu-1')
  })

  it('uses the English copy when the patient language is en', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, metadata: { language: 'en' } })
    await processReviewRequestJob(makeJob())
    const [, , , text] = h.sendWhatsAppText.mock.calls[0]
    expect(text).toContain('feedback')
  })

  it('requires an approved template outside the 24h window and skips without claiming when none exists', async () => {
    h.findLastInboundAt.mockResolvedValue(null) // never wrote → outside window
    await processReviewRequestJob(makeJob())
    expect(h.findApprovedByCategory).toHaveBeenCalledWith(CLINIC, 'review_request')
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    // Not claimed → a later tick can still deliver once a template is approved.
    expect(h.createIfAbsent).not.toHaveBeenCalled()
  })

  it('sends the approved template body (with tracked link) outside the window', async () => {
    h.findLastInboundAt.mockResolvedValue(null) // outside window
    h.findApprovedByCategory.mockResolvedValue({ id: 't1', body: 'APPROVED REVIEW BODY' })
    await processReviewRequestJob(makeJob())
    expect(h.sendWhatsAppText).toHaveBeenCalledTimes(1)
    const [, , , text] = h.sendWhatsAppText.mock.calls[0]
    expect(text).toContain('APPROVED REVIEW BODY')
    expect(text).toContain('g.page/clinic/review') // tracked link appended
    expect(h.markSent).toHaveBeenCalledWith(CLINIC, 'fu-1')
  })

  it('NEVER messages an opted-out patient', async () => {
    h.findPatient.mockResolvedValue({ id: PATIENT, metadata: { optedOut: true } })
    await processReviewRequestJob(makeJob())
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    expect(h.createIfAbsent).not.toHaveBeenCalled()
  })

  it('does not double-send when the review was already claimed', async () => {
    h.createIfAbsent.mockResolvedValue(null) // (appointment, type) already claimed
    await processReviewRequestJob(makeJob())
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  it('skips a clinic with no configured review link', async () => {
    h.listClinics.mockResolvedValue([{ id: CLINIC, status: 'active', settings: {} }])
    await processReviewRequestJob(makeJob())
    expect(h.listCompletedForReview).not.toHaveBeenCalled()
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalled() // db connection always closed
  })

  it('skips a clinic that switched review-request automation off (Screen 12)', async () => {
    h.listClinics.mockResolvedValue([
      {
        id: CLINIC,
        status: 'active',
        settings: {
          reviewLink: 'https://g.page/clinic/review',
          automations: { reviewRequest: { enabled: false } },
        },
      },
    ])
    await processReviewRequestJob(makeJob())
    expect(h.listCompletedForReview).not.toHaveBeenCalled()
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
  })

  it('stays silent when the patient has no WhatsApp contact', async () => {
    h.listContacts.mockResolvedValue([])
    await processReviewRequestJob(makeJob())
    expect(h.sendWhatsAppText).not.toHaveBeenCalled()
    expect(h.createIfAbsent).not.toHaveBeenCalled()
  })
})
