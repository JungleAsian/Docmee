import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { deepgramProvider } from '../transcription/deepgram-provider.js'

const originalFetch = globalThis.fetch
const originalKey = process.env['DEEPGRAM_API_KEY']
const originalStub = process.env['LLM_STUB']

beforeEach(() => {
  vi.restoreAllMocks()
  process.env['DEEPGRAM_API_KEY'] = 'test-key'
  delete process.env['LLM_STUB']
})

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalKey === undefined) delete process.env['DEEPGRAM_API_KEY']
  else process.env['DEEPGRAM_API_KEY'] = originalKey
  if (originalStub === undefined) delete process.env['LLM_STUB']
  else process.env['LLM_STUB'] = originalStub
})

describe('deepgramProvider.transcribe', () => {
  it('returns a stub transcript without any API call when LLM_STUB=true', async () => {
    process.env['LLM_STUB'] = 'true'
    const fetchMock = vi.fn()
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await deepgramProvider.transcribe(new ArrayBuffer(8), 'audio/ogg')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.text).toContain('cita')
    expect(result.language).toBe('es')
    expect(result.confidence).toBeGreaterThan(0)
  })

  it('throws a descriptive error when the API key is missing', async () => {
    delete process.env['DEEPGRAM_API_KEY']
    await expect(deepgramProvider.transcribe(new ArrayBuffer(8), 'audio/ogg')).rejects.toThrow(
      /DEEPGRAM_API_KEY not set/,
    )
  })

  it('parses a successful Deepgram response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript: 'hola doctor',
                  confidence: 0.91,
                  words: [{ word: 'hola', start: 0, end: 0.4, confidence: 0.9 }],
                },
              ],
            },
          ],
          metadata: { duration: 4.5 },
        },
      }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await deepgramProvider.transcribe(new ArrayBuffer(8), 'audio/ogg')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('api.deepgram.com')
    expect(url).toContain('model=nova-3')
    expect(result.text).toBe('hola doctor')
    expect(result.duration_seconds).toBe(4.5)
    expect(result.confidence).toBe(0.91)
    expect(result.words).toHaveLength(1)
  })

  it('throws when Deepgram responds with a non-2xx status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => 'bad key' })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(deepgramProvider.transcribe(new ArrayBuffer(8), 'audio/ogg')).rejects.toThrow(
      /Deepgram error 401/,
    )
  })

  it('throws when the response contains no alternatives', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: { channels: [{ alternatives: [] }], metadata: { duration: 1 } } }),
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(deepgramProvider.transcribe(new ArrayBuffer(8), 'audio/ogg')).rejects.toThrow(
      /empty transcript/,
    )
  })
})
