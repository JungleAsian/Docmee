import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PatientInfoCard } from './PatientInfoCard'

const fixtures = vi.hoisted(() => ({
  conversation: {
    patientId: null,
    patientName: 'Test contact',
    channel: 'whatsapp' as string | undefined,
    channelContactHandle: '+15550100123' as string | undefined,
  },
}))

vi.stubGlobal('React', React)
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({
    data: queryKey[0] === 'conversation' ? { conversation: fixtures.conversation } : undefined,
  }),
}))
vi.mock('../api/client', () => ({ api: { get: vi.fn() } }))
vi.mock('../hooks/useI18n', () => ({
  useI18n: () => ({ language: 'en', t: (key: string) => key }),
}))
vi.mock('./InteractionModeToggle', () => ({ InteractionModeToggle: () => null }))

describe('PatientInfoCard contact display', () => {
  beforeEach(() => {
    fixtures.conversation.channel = 'whatsapp'
    fixtures.conversation.channelContactHandle = '+15550100123'
  })

  it('shows the phone number immediately without a Show or Hide number button', () => {
    const html = renderToStaticMarkup(<PatientInfoCard conversationId="test-conversation" />)

    expect(html).toContain('+15550100123')
    expect(html).not.toContain('Number hidden')
    expect(html).not.toMatch(/<button\b[^>]*>\s*(Show|Hide)\s*<\/button>/)
  })

  it.each(['messenger', 'instagram'])('preserves the %s channel label', (channel) => {
    fixtures.conversation.channel = channel
    fixtures.conversation.channelContactHandle = 'test-contact'
    const html = renderToStaticMarkup(<PatientInfoCard conversationId="test-conversation" />)

    const label = channel === 'messenger' ? 'Messenger' : 'Instagram'
    expect(html).toContain(`${label} · test-contact`)
  })

  it('retains a safe placeholder when contact data is not available', () => {
    fixtures.conversation.channel = undefined
    fixtures.conversation.channelContactHandle = undefined
    const html = renderToStaticMarkup(<PatientInfoCard conversationId="test-conversation" />)

    expect(html).toContain('…')
    expect(html).not.toContain('Number hidden')
    expect(html).not.toContain('undefined')
  })

  it('preserves the separate hide-details control', () => {
    const html = renderToStaticMarkup(
      <PatientInfoCard conversationId="test-conversation" onHideDetails={() => {}} />,
    )

    expect(html).toContain('aria-label="inbox.details.hide"')
    expect(html).toContain('+15550100123')
  })

  it('uses the contact name for initials when no authorized photo is available', () => {
    const html = renderToStaticMarkup(<PatientInfoCard conversationId="test-conversation" />)
    expect(html).toMatch(/crm-conv-avatar[^>]*>TC<\/span>/)
  })
})
