import { describe, it, expect } from 'vitest'
import { classifyExpiry, channelCards, type ServiceCard } from './channelStatus'
import type { Clinic } from './types'

const NOW = Date.parse('2026-06-20T00:00:00Z')

function clinic(overrides: Partial<Clinic>): Clinic {
  return {
    id: 'c-1',
    name: 'Clínica',
    slug: 'clinica',
    plan: 'pro',
    status: 'active',
    timezone: 'America/Mexico_City',
    settings: {},
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...overrides,
  }
}

function card(cards: ServiceCard[], key: string) {
  return cards.find((c) => c.key === key)!
}

describe('classifyExpiry', () => {
  it('returns null for an empty or invalid date', () => {
    expect(classifyExpiry(undefined, NOW)).toBeNull()
    expect(classifyExpiry('not-a-date', NOW)).toBeNull()
  })

  it('flags a past date as expired', () => {
    const e = classifyExpiry('2026-06-10', NOW)!
    expect(e.state).toBe('expired')
    expect(e.daysLeft).toBeLessThan(0)
  })

  it('flags a date within the warning window as expiring', () => {
    expect(classifyExpiry('2026-06-30', NOW)!.state).toBe('expiring')
  })

  it('treats a far-future date as ok', () => {
    expect(classifyExpiry('2026-12-31', NOW)!.state).toBe('ok')
  })
})

describe('channelCards', () => {
  const opts = { apiBase: 'https://api.test', now: NOW }

  it('marks a disabled channel disconnected and renders its webhook URL', () => {
    const m = card(channelCards(clinic({}), opts), 'messenger')
    expect(m.status).toBe('disconnected')
    expect(m.webhookUrl).toBe('https://api.test/webhook/messenger')
  })

  it('marks an enabled-but-incomplete channel pending with concrete issues', () => {
    const m = card(channelCards(clinic({ messengerEnabled: true }), opts), 'messenger')
    expect(m.status).toBe('pending')
    expect(m.issues).toContain('missing_page_id')
    expect(m.issues).toContain('missing_verify_token')
  })

  it('marks a fully configured channel connected', () => {
    const m = card(
      channelCards(
        clinic({
          messengerEnabled: true,
          messengerPageId: 'pg-1',
          messengerWebhookVerifyToken: 'vt',
          settings: { messengerTokenExpiresAt: '2026-12-31' },
        }),
        opts,
      ),
      'messenger',
    )
    expect(m.status).toBe('connected')
    expect(m.tokenExpiry?.state).toBe('ok')
  })

  it('escalates a connected channel to expired when the token has lapsed', () => {
    const m = card(
      channelCards(
        clinic({
          instagramEnabled: true,
          instagramAccountId: 'ig-1',
          instagramWebhookVerifyToken: 'vt',
          settings: { instagramTokenExpiresAt: '2026-06-01' },
        }),
        opts,
      ),
      'instagram',
    )
    expect(m.status).toBe('expired')
  })

  it('connects calendar when OAuth tokens are stored', () => {
    const c = card(channelCards(clinic({ settings: { googleCalendar: { calendarId: 'x' } } }), opts), 'calendar')
    expect(c.status).toBe('connected')
  })

  it('requires the Google connection before Sheets can be used', () => {
    const s = card(
      channelCards(clinic({ settings: { googleSheets: { enabled: true, spreadsheetId: '1A' } } }), opts),
      'sheets',
    )
    expect(s.status).toBe('pending')
    expect(s.issues).toContain('calendar_required')
  })
})
