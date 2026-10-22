import type { LayaAdapterDependencies } from './adapter.js'

/** Same-host only. A fixed path and literal address prevent redirects and DNS-based SSRF. */
export function createLayaHttpTransport(options: {
  endpoint: string
  fetcher?: typeof fetch
}): LayaAdapterDependencies['transport'] {
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/?$/.test(options.endpoint)) {
    throw new Error('invalid LAYA endpoint')
  }
  let endpoint: URL
  try { endpoint = new URL(options.endpoint) } catch { throw new Error('invalid LAYA endpoint') }
  const target = `${endpoint.origin}/v1/decision`
  const fetcher = options.fetcher ?? fetch
  return async (request, signal) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const body = JSON.stringify(request)
      if (Buffer.byteLength(body, 'utf8') > 32_768) throw new Error()
      const response = await fetcher(target, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body,
      })
      if (!response.ok || response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        await response.body?.cancel()
        throw new Error()
      }
      reader = response.body?.getReader()
      if (!reader) throw new Error()
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > 8192) throw new Error()
        chunks.push(chunk.value)
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
    } catch {
      // Never propagate upstream response bodies, URLs, or exception details.
      if (reader) await reader.cancel().catch(() => undefined)
      throw new Error('invalid LAYA response')
    } finally { reader?.releaseLock() }
  }
}
