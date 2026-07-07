import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendTwilioWhatsAppText } from '../twilio-whatsapp-sender.js'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  globalThis.fetch = fetchMock
})

describe('sendTwilioWhatsAppText', () => {
  it('sends through a Messaging Service SID', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sid: 'SM123' }),
    })

    const sid = await sendTwilioWhatsAppText({
      accountSid: 'AC123',
      authToken: 'TOKEN',
      to: '+5215555555555',
      body: 'hola',
      messagingServiceSid: 'MG123',
    })

    expect(sid).toBe('SM123')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toMatch(/^Basic /)
    expect(init.body.get('To')).toBe('whatsapp:+5215555555555')
    expect(init.body.get('Body')).toBe('hola')
    expect(init.body.get('MessagingServiceSid')).toBe('MG123')
  })

  it('falls back to a WhatsApp sender number', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sid: 'SM456' }),
    })

    await sendTwilioWhatsAppText({
      accountSid: 'AC123',
      authToken: 'TOKEN',
      to: 'whatsapp:+5215555555555',
      body: 'hi',
      from: '+15551234567',
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.body.get('To')).toBe('whatsapp:+5215555555555')
    expect(init.body.get('From')).toBe('whatsapp:+15551234567')
  })

  it('surfaces Twilio API errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Authentication Error' }),
    })

    await expect(
      sendTwilioWhatsAppText({
        accountSid: 'AC123',
        authToken: 'BAD',
        to: '+5215555555555',
        body: 'hi',
        messagingServiceSid: 'MG123',
      }),
    ).rejects.toThrow('Authentication Error')
  })
})
