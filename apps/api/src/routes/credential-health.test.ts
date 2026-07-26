import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const dbState = vi.hoisted(() => ({
  queries: [] as Array<{ text: string; values: unknown[] }>,
}))

vi.mock('../lib/db.js', () => ({
  hasDatabaseUrl: () => true,
  withDb: async (callback: (sql: unknown) => Promise<unknown>) => {
    const sql = async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim()
      dbState.queries.push({ text, values })
      if (text === 'SELECT 1') return [{ ok: 1 }]
      if (text.includes('FROM channel_accounts')) {
        return [{
          account_id: 'phone-1',
          display_name: 'Clinic WhatsApp',
          access_token_enc: 'encrypted-whatsapp-token',
          webhook_verify_token: 'stored-verify-token',
          updated_at: '2026-07-26T12:00:00.000Z',
        }]
      }
      if (text.includes('FROM doctors')) return [{ total: '1', connected: '1' }]
      if (text.includes('FROM clinics')) {
        return [{
          name: 'Clinic One',
          settings: {
            aiAssistant: { chatProvider: 'claude' },
            integrations: { claude: { apiKeyEnc: 'encrypted-ai-key' } },
          },
        }]
      }
      throw new Error(`Unexpected query: ${text}`)
    }
    return callback(sql)
  },
}))

import { signAccessToken } from '../auth/jwt.js'
import credentialHealthRoute from './credential-health.js'

describe('credential health clinic scope', () => {
  let app = Fastify()
  let auth: { authorization: string; 'x-clinic-id': string }
  const previousEnv = new Map<string, string | undefined>()
  const requiredEnv = {
    DATABASE_URL: 'postgres://test',
    JWT_SECRET: 'credential-health-access-secret',
    JWT_REFRESH_SECRET: 'credential-health-refresh-secret',
    META_APP_ID: 'meta-app',
    META_EMBEDDED_SIGNUP_CONFIG_ID: 'meta-config',
    META_APP_SECRET: 'meta-secret',
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GOOGLE_REDIRECT_URI: 'https://example.test/callback',
  }

  beforeAll(async () => {
    for (const [name, value] of Object.entries(requiredEnv)) {
      previousEnv.set(name, process.env[name])
      process.env[name] = value
    }
    auth = {
      authorization: `Bearer ${signAccessToken({
        userId: 'studio-1',
        clinicId: 'home-clinic',
        role: 'ia_studio_admin',
        email: 'studio@example.test',
      })}`,
      'x-clinic-id': 'clinic-1',
    }
    app = Fastify()
    await app.register(credentialHealthRoute)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    for (const [name, value] of previousEnv) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })

  it('reports provider health for the active clinic without exposing stored secrets', async () => {
    dbState.queries = []

    const response = await app.inject({
      method: 'GET',
      url: '/credential-health',
      headers: auth,
    })

    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.clinic).toEqual({ id: 'clinic-1', name: 'Clinic One' })
    expect(body.credentials).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'meta-whatsapp',
        configured: true,
        validation: expect.stringContaining('Access token stored.'),
      }),
      expect.objectContaining({
        key: 'google-calendar',
        configured: true,
        validation: '1 of 1 active doctors have calendar credentials.',
      }),
      expect.objectContaining({
        key: 'ai-provider',
        configured: true,
        validation: 'Clinic One uses claude via clinic credential.',
      }),
    ]))
    expect(response.body).not.toContain('encrypted-whatsapp-token')
    expect(response.body).not.toContain('stored-verify-token')
    expect(response.body).not.toContain('encrypted-ai-key')

    const scopedQueries = dbState.queries.filter(({ text }) =>
      text.includes('FROM channel_accounts') ||
      text.includes('FROM doctors') ||
      text.includes('FROM clinics'))
    expect(scopedQueries).toHaveLength(3)
    expect(scopedQueries.every(({ values }) => values.includes('clinic-1'))).toBe(true)
  })
})
