import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => ({
  queries: [] as string[],
}))

vi.mock('../lib/db.js', () => ({
  withDb: async (callback: (sql: unknown) => Promise<unknown>) => {
    const sql = async (strings: TemplateStringsArray) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim()
      dbState.queries.push(text)
      return [{
        doctorsWithoutServices: 0,
        doctorsWithoutCalendar: 1,
        unsentFollowUps: 0,
        openMetaErrors: 1,
        reviewEnabled: false,
        reviewLink: '',
      }]
    }
    return callback(sql)
  },
}))

vi.mock('@docmee/db', () => ({
  createFollowUpsRepository: () => ({}),
}))

vi.mock('@docmee/queue', () => ({
  followUpQueue: { add: vi.fn() },
}))

import { signAccessToken } from '../auth/jwt.js'
import followUpsRoute from './follow-ups.js'

describe('automation health', () => {
  let app = Fastify()
  let auth: { authorization: string }

  beforeAll(async () => {
    process.env['JWT_SECRET'] = 'automation-health-access-secret'
    process.env['JWT_REFRESH_SECRET'] = 'automation-health-refresh-secret'
    auth = {
      authorization: `Bearer ${signAccessToken({
        userId: 'admin-1',
        clinicId: 'clinic-1',
        role: 'clinic_admin',
        email: 'admin@example.test',
      })}`,
    }
    app = Fastify()
    await app.register(followUpsRoute)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('treats lost provider acceptance correlation as an unresolved Meta error', async () => {
    dbState.queries = []
    const response = await app.inject({
      method: 'GET',
      url: '/clinics/clinic-1/automation-health',
      headers: auth,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      state: 'attention',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'doctor_calendar_missing', count: 1 }),
        expect.objectContaining({ code: 'meta_sync_errors_open', count: 1 }),
      ]),
    })
    expect(dbState.queries).toHaveLength(1)
    expect(dbState.queries[0]).toContain("e.error_type = 'provider_acceptance_persistence_failure'")
    expect(dbState.queries[0]).toContain("NULLIF(d.google_calendar_access_token_encrypted, '') IS NOT NULL")
    expect(dbState.queries[0]).not.toContain("c.settings #>> '{googleCalendar,accessToken}'")
  })
})
