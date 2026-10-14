import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ConversationView } from './ConversationView'
import type { Channel } from '../types'

vi.stubGlobal('React', React)
vi.mock('../hooks/useI18n', () => ({
  useI18n: () => ({ language: 'en', t: (key: string) => key }),
}))

function renderHeader(channel: Channel = 'whatsapp', handle: string | undefined = '+15550100123') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  client.setQueryData(['conversation', 'test-conversation'], {
    conversation: {
      id: 'test-conversation', patientName: 'Test contact', channel,
      channelContactHandle: handle, status: 'open', metadata: {},
    },
  })
  client.setQueryData(['messages', 'test-conversation'], { messages: [] })
  const html = renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <ConversationView conversationId="test-conversation" />
    </QueryClientProvider>,
  )
  client.clear()
  return html.slice(html.indexOf('class="crm-chat-header"'), html.indexOf('class="crm-chat-messages'))
}

describe('ConversationView contact header', () => {
  it('shows the contact number on first render with no visibility toggle', () => {
    const header = renderHeader()
    expect(header).toContain('+15550100123')
    expect(header).not.toContain('Show number')
    expect(header).not.toContain('Hide number')
  })

  it.each(['messenger', 'instagram'] as const)('preserves the %s contact handle and channel label', (channel) => {
    const header = renderHeader(channel, 'test-contact')
    expect(header).toContain('test-contact')
    expect(header).toContain(channel === 'messenger' ? 'Messenger' : 'Instagram')
  })

  it('does not render a visibility toggle for an empty handle', () => {
    const header = renderHeader('whatsapp', '')
    expect(header).toContain('Test contact')
    expect(header).not.toContain('Show number')
    expect(header).not.toContain('Hide number')
    expect(header).not.toContain('undefined')
  })
})
