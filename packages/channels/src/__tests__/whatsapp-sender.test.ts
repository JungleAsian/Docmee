import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsAppText, sendWhatsAppInteractiveButtons } from '../whatsapp-sender.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('sendWhatsAppText', () => {
  it('POSTs a text message to the Graph API with auth + body and returns the wamid', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ({ messages: [{ id: 'wamid.OUT123' }] }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const wamid = await sendWhatsAppText('PHONE_ID', 'TOKEN', '5215555555555', 'hola')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/PHONE_ID/messages')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer TOKEN')
    const body = JSON.parse(init.body as string) as { to: string; text: { body: string }; type: string }
    expect(body.to).toBe('5215555555555')
    expect(body.type).toBe('text')
    expect(body.text.body).toBe('hola')
    // The wamid Meta echoes back is returned so delivery-status webhooks (Req 3)
    // can be matched to the sent message.
    expect(wamid).toBe('wamid.OUT123')
  })

  it('rejects provider acceptance that cannot be correlated to a receipt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ({}),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(sendWhatsAppText('PHONE_ID', 'TOKEN', '521', 'hi')).rejects.toThrow(
      'WhatsApp send response missing message id',
    )
  })

  it('throws when the Graph API responds with an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(sendWhatsAppText('PHONE_ID', 'BAD', '521', 'hi')).rejects.toThrow(/401/)
  })

  it.each(['', '   ', '\n\t'])('rejects an empty text body before calling Meta', async (text) => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(sendWhatsAppText('PHONE_ID', 'TOKEN', '521', text)).rejects.toThrow(
      'WhatsApp text body must not be empty',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('trims the text body before sending it to Meta', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.TRIMMED' }] }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await sendWhatsAppText('PHONE_ID', 'TOKEN', '521', '  hello  ')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { text: { body: string } }
    expect(body.text.body).toBe('hello')
  })
})

describe('sendWhatsAppInteractiveButtons', () => {
  it('sends an image header (not text) when headerImageUrl is set', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.BTN1' }] }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await sendWhatsAppInteractiveButtons('PHONE_ID', 'TOKEN', '521', {
      body: 'Please confirm',
      header: 'Confirm',
      headerImageUrl: 'https://app.docmeedevelopment.dev/icon-512.png',
      options: [{ id: 'confirm', title: 'Confirm' }],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string) as { interactive: { header?: unknown } }
    expect(payload.interactive.header).toEqual({
      type: 'image',
      image: { link: 'https://app.docmeedevelopment.dev/icon-512.png' },
    })
  })

  it('falls back to a text header when no headerImageUrl is given', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.BTN2' }] }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await sendWhatsAppInteractiveButtons('PHONE_ID', 'TOKEN', '521', {
      body: 'Please confirm',
      header: 'Confirm',
      options: [{ id: 'confirm', title: 'Confirm' }],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const payload = JSON.parse(init.body as string) as { interactive: { header?: unknown } }
    expect(payload.interactive.header).toEqual({ type: 'text', text: 'Confirm' })
  })
})
