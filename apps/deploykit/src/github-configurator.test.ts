import { describe, it, expect, afterEach, vi } from 'vitest'
import { getLatestRelease } from './github-configurator.js'

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): void {
  vi.stubGlobal('fetch', vi.fn(async () => response as unknown as Response))
}

describe('getLatestRelease', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns version and downloadUrl', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v1.4.0',
        published_at: '2026-06-01T00:00:00Z',
        assets: [
          { name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt', size: 10 },
          { name: 'docmee-1.4.0.tar.gz', browser_download_url: 'https://example.com/docmee.tar.gz', size: 2048 },
        ],
      }),
    })

    const release = await getLatestRelease('docmee/docmee')

    expect(release.version).toBe('v1.4.0')
    expect(release.downloadUrl).toBe('https://example.com/docmee.tar.gz')
    expect(release.size).toBe(2048)
    expect(release.publishedAt).toBe('2026-06-01T00:00:00Z')
  })

  it('handles 404 gracefully', async () => {
    mockFetch({ ok: false, status: 404, json: async () => ({}) })

    await expect(getLatestRelease('docmee/missing')).rejects.toThrow('GitHub API error: 404')
  })

  it('throws when no downloadable asset is present', async () => {
    mockFetch({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v1.0.0',
        published_at: '2026-01-01T00:00:00Z',
        assets: [{ name: 'notes.txt', browser_download_url: 'https://example.com/notes.txt', size: 10 }],
      }),
    })

    await expect(getLatestRelease('docmee/docmee')).rejects.toThrow('No release asset found')
  })
})
