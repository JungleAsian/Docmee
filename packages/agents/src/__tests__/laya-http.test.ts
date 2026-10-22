import { describe, expect, it, vi } from 'vitest'
import { createLayaHttpTransport } from '../laya/http.js'
import type { LayaRequest } from '../laya/adapter.js'

const request: LayaRequest = { schemaVersion: 1, requestId: 'opaque-id', task: 'administrative_intent',
  language: 'en', text: 'Book please', candidates: [{ id: 'booking', label: 'Book an appointment' }] }

describe('private LAYA HTTP transport', () => {
  it.each(['https://public.example', 'http://169.254.169.254', 'http://localhost:8501',
    'http://127.0.0.1:8501@public.example', 'http://127.0.0.1:8501/other', 'http://127.0.0.1:8501/?token=private'])(
    'rejects non-loopback, ambiguous and non-root endpoints: %s', endpoint => {
      expect(() => createLayaHttpTransport({ endpoint })).toThrow()
    })

  it('uses a fixed private endpoint and disallows redirects', async () => {
    const fetcher = vi.fn(async () => new Response('{"test":true}', { headers: { 'Content-Type': 'application/json' } }))
    const transport = createLayaHttpTransport({ endpoint: 'http://127.0.0.1:8501', fetcher })
    const signal = new AbortController().signal
    expect(await transport(request, signal)).toEqual({ test: true })
    expect(fetcher).toHaveBeenCalledWith('http://127.0.0.1:8501/v1/decision', expect.objectContaining({
      method: 'POST', redirect: 'error', signal, body: JSON.stringify(request),
    }))
  })

  it('rejects oversized streaming responses even without Content-Length', async () => {
    const fetcher = vi.fn(async () => new Response('x'.repeat(8193), { headers: { 'Content-Type': 'application/json' } }))
    const transport = createLayaHttpTransport({ endpoint: 'http://127.0.0.1:8501', fetcher })
    await expect(transport(request, new AbortController().signal)).rejects.toThrow('invalid LAYA response')
  })

  it.each([
    () => new Response('private error details', { status: 500 }),
    () => new Response('{}', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('not json', { headers: { 'Content-Type': 'application/json' } }),
  ])('rejects bad status, type and JSON without leaking upstream details', async response => {
    const transport = createLayaHttpTransport({ endpoint: 'http://127.0.0.1:8501', fetcher: async () => response() })
    await expect(transport(request, new AbortController().signal)).rejects.toThrow('invalid LAYA response')
  })
})
