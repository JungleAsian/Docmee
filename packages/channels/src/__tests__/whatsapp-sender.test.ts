import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWhatsAppInteractive, sendWhatsAppList, sendWhatsAppText } from '../whatsapp-sender.js'

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

  it('returns null when the Graph API response carries no message id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ({}),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect(await sendWhatsAppText('PHONE_ID', 'TOKEN', '521', 'hi')).toBeNull()
  })

  it('throws when the Graph API responds with an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => 'unauthorized' })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(sendWhatsAppText('PHONE_ID', 'BAD', '521', 'hi')).rejects.toThrow(/401/)
  })
})

describe('sendWhatsAppInteractive', () => {
  it('POSTs official Meta reply buttons with stable option ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ({ messages: [{ id: 'wamid.BUTTONS' }] }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const wamid = await sendWhatsAppInteractive('PHONE_ID', 'TOKEN', '5215555555555', 'Confirm appointment?', [
      { id: 'confirm_booking', title: 'Confirm' },
      { id: 'change_selection', title: 'Change' },
    ])

    expect(wamid).toBe('wamid.BUTTONS')
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      type: string
      interactive: { type: string; action: { buttons: Array<{ reply: { id: string; title: string } }> } }
    }
    expect(body.type).toBe('interactive')
    expect(body.interactive.type).toBe('button')
    expect(body.interactive.action.buttons.map((button) => button.reply.id)).toEqual([
      'confirm_booking',
      'change_selection',
    ])
  })

  it('enforces Meta button and non-empty body limits before sending', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(sendWhatsAppInteractive('PHONE_ID', 'TOKEN', '521', '', ['One'])).rejects.toThrow(/body/i)
    await expect(sendWhatsAppInteractive('PHONE_ID', 'TOKEN', '521', 'Pick', ['One', 'Two', 'Three', 'Four'])).rejects.toThrow(/1 to 3/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('sendWhatsAppList', () => {
  it('POSTs official Meta list rows with stable row ids', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '',
      json: async () => ({ messages: [{ id: 'wamid.LIST' }] }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await sendWhatsAppList('PHONE_ID', 'TOKEN', '5215555555555', 'Choose a doctor', 'Choose', [
      {
        title: 'Doctors',
        rows: [
          { id: 'doctor_123', title: 'Dr. Patrick', description: 'Cardiology' },
          { id: 'doctor_456', title: 'Dr. Ana' },
        ],
      },
    ])

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      interactive: { type: string; action: { sections: Array<{ rows: Array<{ id: string; title: string }> }> } }
    }
    expect(body.interactive.type).toBe('list')
    expect(body.interactive.action.sections[0]?.rows.map((row) => row.id)).toEqual(['doctor_123', 'doctor_456'])
  })

  it('rejects list payloads outside Meta row limits before sending', async () => {
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const rows = Array.from({ length: 11 }, (_, index) => ({ id: `row_${index}`, title: `Row ${index}` }))

    await expect(sendWhatsAppList('PHONE_ID', 'TOKEN', '521', 'Pick', 'Choose', [{ rows }])).rejects.toThrow(/at most 10/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
