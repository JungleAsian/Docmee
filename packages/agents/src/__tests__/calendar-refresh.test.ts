import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture the OAuth2 client instances built per binding so a test can inspect the
// credentials and simulate googleapis emitting a refreshed token.
const oauthInstances = vi.hoisted(() => [] as FakeAuth[])

class FakeAuth {
  credentials: Record<string, unknown> = {}
  private handlers: Array<(t: Record<string, unknown>) => void> = []
  setCredentials(c: Record<string, unknown>) {
    this.credentials = c
  }
  on(_event: 'tokens', cb: (t: Record<string, unknown>) => void) {
    this.handlers.push(cb)
  }
  emitTokens(t: Record<string, unknown>) {
    this.handlers.forEach((h) => h(t))
  }
}

vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class {
        constructor() {
          const inst = new FakeAuth()
          oauthInstances.push(inst)
          return inst
        }
      },
    },
    calendar: ({ auth }: { auth: FakeAuth }) => ({
      events: {
        list: async () => ({ data: { items: [] } }),
        // Simulate a request that triggers an access-token refresh.
        insert: async () => {
          auth.emitTokens({ access_token: 'refreshed-at', expiry_date: 2_000_000_000_000 })
          return { data: { id: 'evt_new' } }
        },
        patch: async () => ({ data: {} }),
        delete: async () => ({ data: {} }),
      },
    }),
  },
}))

import { createGoogleCalendarOps } from '../calbot/google-calendar-client.js'

beforeEach(() => {
  oauthInstances.length = 0
})

describe('createGoogleCalendarOps token refresh', () => {
  it('sets an expiry on the credentials so googleapis can auto-refresh', async () => {
    const ops = createGoogleCalendarOps({
      accessToken: 'at',
      refreshToken: 'rt',
      calendarId: 'primary',
      timezone: 'America/Guatemala',
      expiryDate: 1_700_000_000_000,
    })
    await ops.listSlots('2026-07-01')
    expect(oauthInstances).toHaveLength(1)
    expect(oauthInstances[0]!.credentials).toMatchObject({
      access_token: 'at',
      refresh_token: 'rt',
      expiry_date: 1_700_000_000_000,
    })
  })

  it('forces a refresh (past expiry) when no expiry is stored', async () => {
    const ops = createGoogleCalendarOps({
      accessToken: 'at',
      refreshToken: 'rt',
      calendarId: 'primary',
      timezone: 'America/Guatemala',
    })
    await ops.listSlots('2026-07-01')
    expect(oauthInstances[0]!.credentials['expiry_date']).toBe(1)
  })

  it('forwards refreshed tokens to onTokensRefreshed', async () => {
    const onTokensRefreshed = vi.fn()
    const ops = createGoogleCalendarOps({
      accessToken: 'at',
      refreshToken: 'rt',
      calendarId: 'primary',
      timezone: 'America/Guatemala',
      onTokensRefreshed,
    })
    const eventId = await ops.createEvent({
      title: 'Cita',
      date: '2026-07-01',
      time: '10:00',
      durationMinutes: 30,
    })
    expect(eventId).toBe('evt_new')
    expect(onTokensRefreshed).toHaveBeenCalledWith({
      accessToken: 'refreshed-at',
      refreshToken: undefined,
      expiryDate: 2_000_000_000_000,
    })
  })

  it('reuses a single authed client across ops in one binding', async () => {
    const ops = createGoogleCalendarOps({
      accessToken: 'at',
      refreshToken: 'rt',
      calendarId: 'primary',
      timezone: 'America/Guatemala',
    })
    await ops.listSlots('2026-07-01')
    await ops.createEvent({ title: 'Cita', date: '2026-07-01', time: '10:00', durationMinutes: 30 })
    expect(oauthInstances).toHaveLength(1)
  })
})
