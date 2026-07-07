import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { downloadMedia } from '../media-downloader.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('downloadMedia', () => {
  it('resolves the media URL then downloads the binary', async () => {
    const bytes = new ArrayBuffer(8)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ url: 'https://cdn/media', mime_type: 'audio/ogg' }) })
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => bytes })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const result = await downloadMedia('MEDIA_ID', 'TOKEN')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((fetchMock.mock.calls[0][0] as string)).toContain('/MEDIA_ID')
    expect(fetchMock.mock.calls[1][0]).toBe('https://cdn/media')
    expect(result.mimeType).toBe('audio/ogg')
    expect(result.buffer).toBe(bytes)
  })

  it('throws when the media URL lookup fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    await expect(downloadMedia('MEDIA_ID', 'TOKEN')).rejects.toThrow(/404/)
  })
})
