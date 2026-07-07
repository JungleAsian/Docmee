import { writeFile } from 'node:fs/promises'

export interface ReleaseInfo {
  version: string
  downloadUrl: string
  publishedAt: string
  size: number
}

interface GithubReleaseResponse {
  tag_name: string
  published_at: string
  assets: Array<{ browser_download_url: string; size: number; name: string }>
}

/**
 * Look up the latest published release for a repo (e.g. "yourorg/docmee") and
 * return the first downloadable bundle asset (.tar.gz or .zip). A GITHUB_TOKEN
 * in the environment is used when present so private repos / higher rate limits
 * work, but it is optional for public releases (Gap #21).
 */
export async function getLatestRelease(repo: string): Promise<ReleaseInfo> {
  const token = process.env['GITHUB_TOKEN']
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers })
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`)

  const data = (await res.json()) as GithubReleaseResponse
  const asset = data.assets.find((a) => a.name.endsWith('.tar.gz') || a.name.endsWith('.zip'))
  if (!asset) throw new Error('No release asset found')

  return {
    version: data.tag_name,
    downloadUrl: asset.browser_download_url,
    publishedAt: data.published_at,
    size: asset.size,
  }
}

/**
 * Stream a release asset to disk, reporting download progress (0-100) as it
 * goes. Falls back to indeterminate progress when the server omits a
 * content-length header.
 */
export async function downloadRelease(
  url: string,
  destPath: string,
  onProgress: (percent: number) => void,
): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Download failed: ${res.status}`)
  if (!res.body) throw new Error('Download failed: empty response body')

  const total = Number.parseInt(res.headers.get('content-length') ?? '0', 10)
  let received = 0
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    chunks.push(value)
    received += value.length
    if (total > 0) onProgress(Math.round((received / total) * 100))
  }
  if (total <= 0) onProgress(100)

  const buffer = Buffer.concat(chunks)
  await writeFile(destPath, buffer)
}
