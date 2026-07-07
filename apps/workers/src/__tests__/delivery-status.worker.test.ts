import { describe, it, expect, vi, beforeEach } from 'vitest'

// WhatsApp delivery-status tracking (Req 3). The worker resolves the clinic from
// the phone_number_id, matches the wamid to a persisted outbound message and
// records the lifecycle event — logging an error review only on a failed delivery.

const h = vi.hoisted(() => ({
  findByAccount: vi.fn(),
  findByMessengerPageId: vi.fn(),
  findByInstagramAccountId: vi.fn(),
  findOpenByContact: vi.fn(),
  recordDeliveryStatus: vi.fn(),
  recordReadReceipt: vi.fn(),
  createError: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: h.end }),
  createChannelAccountsRepository: () => ({ findByAccount: h.findByAccount }),
  createClinicsRepository: () => ({
    findByMessengerPageId: h.findByMessengerPageId,
    findByInstagramAccountId: h.findByInstagramAccountId,
  }),
  createConversationsRepository: () => ({ findOpenByContact: h.findOpenByContact }),
  createMessagesRepository: () => ({
    recordDeliveryStatus: h.recordDeliveryStatus,
    recordReadReceipt: h.recordReadReceipt,
  }),
  createErrorReviewsRepository: () => ({ create: h.createError }),
}))

import { processDeliveryStatusJob } from '../delivery-status.worker.js'

const CLINIC = '11111111-1111-1111-1111-111111111111'
const makeJob = (data: unknown) => ({ data }) as never

beforeEach(() => {
  vi.clearAllMocks()
  h.findByAccount.mockResolvedValue({ clinicId: CLINIC, accountId: 'PHONE_ID' })
  h.findByMessengerPageId.mockResolvedValue({ id: CLINIC })
  h.findByInstagramAccountId.mockResolvedValue({ id: CLINIC })
  h.findOpenByContact.mockResolvedValue({ id: 'conv-1' })
  h.recordDeliveryStatus.mockResolvedValue(true)
  h.recordReadReceipt.mockResolvedValue(2)
  h.createError.mockResolvedValue({ id: 'e1' })
})

describe('processDeliveryStatusJob', () => {
  it('records a delivered receipt against the matched message and logs no error', async () => {
    await processDeliveryStatusJob(
      makeJob({ phoneNumberId: 'PHONE_ID', channelMessageId: 'wamid.OUT1', status: 'delivered' }),
    )

    expect(h.recordDeliveryStatus).toHaveBeenCalledWith(CLINIC, 'wamid.OUT1', 'delivered', null)
    expect(h.createError).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalledTimes(1)
  })

  it('records a failed receipt and logs a whatsapp_delivery_failure error review', async () => {
    await processDeliveryStatusJob(
      makeJob({
        phoneNumberId: 'PHONE_ID',
        channelMessageId: 'wamid.OUT2',
        status: 'failed',
        recipientId: '5215555555555',
        errorTitle: 'Re-engagement message',
        errorCode: 131047,
      }),
    )

    expect(h.recordDeliveryStatus).toHaveBeenCalledWith(
      CLINIC,
      'wamid.OUT2',
      'failed',
      'Re-engagement message (131047)',
    )
    expect(h.createError).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: CLINIC, errorType: 'whatsapp_delivery_failure' }),
    )
  })

  it('drops the receipt when no WhatsApp account owns the phone number', async () => {
    h.findByAccount.mockResolvedValue(null)

    await processDeliveryStatusJob(
      makeJob({ phoneNumberId: 'UNKNOWN', channelMessageId: 'wamid.X', status: 'read' }),
    )

    expect(h.recordDeliveryStatus).not.toHaveBeenCalled()
    expect(h.createError).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalledTimes(1)
  })

  it('does not log an error review when a failed receipt matches no stored message', async () => {
    h.recordDeliveryStatus.mockResolvedValue(false)

    await processDeliveryStatusJob(
      makeJob({ phoneNumberId: 'PHONE_ID', channelMessageId: 'wamid.GONE', status: 'failed' }),
    )

    expect(h.recordDeliveryStatus).toHaveBeenCalledTimes(1)
    expect(h.createError).not.toHaveBeenCalled()
  })

  it('records a Messenger delivered receipt, resolving the clinic by Page id', async () => {
    await processDeliveryStatusJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'PAGE_ID',
        channelMessageId: 'mid.OUT1',
        status: 'delivered',
        recipientId: 'PSID_123',
      }),
    )

    expect(h.findByMessengerPageId).toHaveBeenCalledWith('PAGE_ID')
    expect(h.findByAccount).not.toHaveBeenCalled()
    expect(h.recordDeliveryStatus).toHaveBeenCalledWith(CLINIC, 'mid.OUT1', 'delivered', null)
    expect(h.createError).not.toHaveBeenCalled()
  })

  it('marks the Messenger thread read up to the watermark', async () => {
    await processDeliveryStatusJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'PAGE_ID',
        status: 'read',
        recipientId: 'PSID_123',
        watermark: 1700000002000,
      }),
    )

    expect(h.findOpenByContact).toHaveBeenCalledWith(CLINIC, 'messenger', 'PSID_123')
    expect(h.recordReadReceipt).toHaveBeenCalledWith(CLINIC, 'conv-1', 1700000002000)
    expect(h.recordDeliveryStatus).not.toHaveBeenCalled()
  })

  it('ignores a Messenger read when the patient has no open thread', async () => {
    h.findOpenByContact.mockResolvedValue(null)

    await processDeliveryStatusJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'PAGE_ID',
        status: 'read',
        recipientId: 'PSID_123',
        watermark: 1700000002000,
      }),
    )

    expect(h.recordReadReceipt).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalledTimes(1)
  })

  it('drops a Messenger receipt when no clinic owns the Page id', async () => {
    h.findByMessengerPageId.mockResolvedValue(null)

    await processDeliveryStatusJob(
      makeJob({
        channel: 'messenger',
        phoneNumberId: 'UNKNOWN_PAGE',
        channelMessageId: 'mid.X',
        status: 'delivered',
      }),
    )

    expect(h.recordDeliveryStatus).not.toHaveBeenCalled()
    expect(h.recordReadReceipt).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalledTimes(1)
  })

  it('records an Instagram delivered receipt, resolving the clinic by IG account id', async () => {
    await processDeliveryStatusJob(
      makeJob({
        channel: 'instagram',
        phoneNumberId: 'IG_ACCOUNT_ID',
        channelMessageId: 'mid.OUT1',
        status: 'delivered',
        recipientId: 'IGSID_123',
      }),
    )

    expect(h.findByInstagramAccountId).toHaveBeenCalledWith('IG_ACCOUNT_ID')
    expect(h.findByAccount).not.toHaveBeenCalled()
    expect(h.findByMessengerPageId).not.toHaveBeenCalled()
    expect(h.recordDeliveryStatus).toHaveBeenCalledWith(CLINIC, 'mid.OUT1', 'delivered', null)
    expect(h.createError).not.toHaveBeenCalled()
  })

  it('marks the Instagram thread read up to the watermark', async () => {
    await processDeliveryStatusJob(
      makeJob({
        channel: 'instagram',
        phoneNumberId: 'IG_ACCOUNT_ID',
        status: 'read',
        recipientId: 'IGSID_123',
        watermark: 1700000002000,
      }),
    )

    expect(h.findOpenByContact).toHaveBeenCalledWith(CLINIC, 'instagram', 'IGSID_123')
    expect(h.recordReadReceipt).toHaveBeenCalledWith(CLINIC, 'conv-1', 1700000002000)
    expect(h.recordDeliveryStatus).not.toHaveBeenCalled()
  })

  it('drops an Instagram receipt when no clinic owns the IG account id', async () => {
    h.findByInstagramAccountId.mockResolvedValue(null)

    await processDeliveryStatusJob(
      makeJob({
        channel: 'instagram',
        phoneNumberId: 'UNKNOWN_IG',
        channelMessageId: 'mid.X',
        status: 'delivered',
      }),
    )

    expect(h.recordDeliveryStatus).not.toHaveBeenCalled()
    expect(h.recordReadReceipt).not.toHaveBeenCalled()
    expect(h.end).toHaveBeenCalledTimes(1)
  })
})
