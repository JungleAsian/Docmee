import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendMessengerText } from '../messenger-sender.js'

const originalFetch = globalThis.fetch
const originalStub = process.env['LLM_STUB']

beforeEach(() => {
  vi.restoreAllMocks()
  delete process.env['LLM_STUB']
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalStub === undefined) delete process.env['LLM_STUB']
  else process.env['LLM_STUB'] = originalStub
})

describe('sendMessengerText', () => {
  it('POSTs a text message to the Send API and returns the mid', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ recipient_id: 'PSID_123', message_id: 'mid.OUT1' }) })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const mid = await sendMessengerText('PAGE_TOKEN', 'PSID_123', 'hola')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/me/messages')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer PAGE_TOKEN')
    const body = JSON.parse(init.body as string) as { recipient: { id: string }; message: { text: string } }
    expect(body.recipient.id).toBe('PSID_123')
    expect(body.message.text).toBe('hola')
    expect(mid).toBe('mid.OUT1')
  })

  it('returns null when the Send API response carries no message_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ recipient_id: 'PSID_123' }) })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect(await sendMessengerText('PAGE_TOKEN', 'PSID_123', 'hola')).toBeNull()
  })

  it('does not call the API and returns null when LLM_STUB=true', async () => {
    process.env['LLM_STUB'] = 'true'
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    expect(await sendMessengerText('PAGE_TOKEN', 'PSID_123', 'hola')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws when the Send API responds with an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'bad' })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(sendMessengerText('PAGE_TOKEN', 'PSID', 'hi')).rejects.toThrow(/400/)
  })
})
