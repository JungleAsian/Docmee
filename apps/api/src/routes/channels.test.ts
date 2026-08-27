import Fastify from 'fastify'
import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const channelStore = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  created: null as Record<string, unknown> | null,
}))

vi.mock('@docmee/db', () => ({
  createChannelAccountsRepository: () => ({
    listByClinic: async (clinicId: string) =>
      channelStore.accounts.filter((account) => account.clinicId === clinicId),
    create: async (input: Record<string, unknown>) => {
      channelStore.created = input
      return {
        id: 'acc-saved',
        ...input,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      }
    },
    delete: vi.fn(),
  }),
}))
vi.mock('@docmee/shared', () => ({
  decryptValue: (value: string) => value.startsWith('enc:') ? value.slice(4) : value,
  encryptValue: (value: string) => `enc:${value}`,
}))
vi.mock('../lib/db.js', () => ({
  withDb: async (callback: (sql: unknown) => unknown) => callback({}),
}))

import { signAccessToken } from '../auth/jwt.js'
import channelsRoute from './channels.js'

const baseAccount = {
  id: 'acc-1',
  clinicId: 'c-1',
  channel: 'whatsapp',
  accountId: 'phone-1',
  displayName: 'Clinic WhatsApp',
  status: 'active',
  accessTokenEnc: 'live-token',
  webhookVerifyToken: 'verify',
  settings: {
    provider: 'meta_whatsapp',
    tokenExpiresAt: '2099-01-01T00:00:00.000Z',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('Meta phone registration', () => {
  let app = Fastify()
  let previousJwtSecret: string | undefined
  let previousEncryptionKey: string | undefined
  let clinicAdminAuth: { authorization: string }
  let foreignClinicAdminAuth: { authorization: string }
  let secretaryAuth: { authorization: string }

  beforeAll(async () => {
    previousJwtSecret = process.env['JWT_SECRET']
    previousEncryptionKey = process.env['ENCRYPTION_KEY']
    process.env['JWT_SECRET'] = 'channels-registration-test-secret'
    process.env['ENCRYPTION_KEY'] = 'channels-registration-encryption-test-secret'
    clinicAdminAuth = {
      authorization: `Bearer ${signAccessToken({
        userId: 'admin-1',
        clinicId: 'c-1',
        role: 'clinic_admin',
        email: 'admin@clinic.test',
      })}`,
    }
    foreignClinicAdminAuth = {
      authorization: `Bearer ${signAccessToken({
        userId: 'admin-2',
        clinicId: 'c-2',
        role: 'clinic_admin',
        email: 'admin@other.test',
      })}`,
    }
    secretaryAuth = {
      authorization: `Bearer ${signAccessToken({
        userId: 'staff-1',
        clinicId: 'c-1',
        role: 'secretary',
        email: 'staff@clinic.test',
      })}`,
    }
    app = Fastify()
    await app.register(channelsRoute)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
    if (previousJwtSecret === undefined) delete process.env['JWT_SECRET']
    else process.env['JWT_SECRET'] = previousJwtSecret
    if (previousEncryptionKey === undefined) delete process.env['ENCRYPTION_KEY']
    else process.env['ENCRYPTION_KEY'] = previousEncryptionKey
  })

  afterEach(() => {
    channelStore.accounts = []
    channelStore.created = null
    vi.unstubAllGlobals()
  })

  function addMetaAccount() {
    channelStore.accounts = [{
      ...baseAccount,
      accessTokenEnc: 'enc:live-token',
      settings: { ...baseAccount.settings, wabaId: 'waba-1' },
    }]
  }

  it('projects active channel names to staff without provider identifiers or secrets', async () => {
    channelStore.accounts = [
      { ...baseAccount, accessTokenEnc: 'enc:top-secret', settings: { wabaId: 'waba-secret' } },
      { ...baseAccount, id: 'acc-2', channel: 'instagram', displayName: 'Old Instagram', status: 'inactive' },
    ]

    const response = await app.inject({
      method: 'GET',
      url: '/clinics/c-1/channels/active',
      headers: secretaryAuth,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      channels: [{ channel: 'whatsapp', name: 'Clinic WhatsApp' }],
    })
    expect(response.body).not.toContain('acc-1')
    expect(response.body).not.toContain('phone-1')
    expect(response.body).not.toContain('top-secret')
    expect(response.body).not.toContain('waba-secret')
  })

  it('clears stale token expiry metadata for a non-expiring system-user token', async () => {
    addMetaAccount()
    channelStore.accounts[0]!.accountId = '1220622364468433'

    const response = await app.inject({
      method: 'PUT',
      url: '/clinics/c-1/channels/whatsapp',
      headers: clinicAdminAuth,
      payload: {
        accountId: '1220622364468433',
        tokenExpiresAt: null,
        status: 'active',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(channelStore.created).toMatchObject({
      clinicId: 'c-1',
      accountId: '1220622364468433',
      settings: {
        provider: 'meta_whatsapp',
        tokenExpiresAt: null,
      },
    })
    expect(response.json().account.tokenExpiresAt).toBeNull()
  })

  it('validates a phone and WABA pair without persisting credentials', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: '1220622364468433',
          display_phone_number: '+1 202 555-0199',
          verified_name: 'Docmee',
          platform_type: 'CLOUD_API',
          status: 'CONNECTED',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '1220622364468433' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/channels/whatsapp/validate',
      headers: clinicAdminAuth,
      payload: {
        accountId: '1220622364468433',
        wabaId: '1485673640028042',
        accessToken: 'meta-token',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      valid: true,
      phone: {
        displayPhoneNumber: '+1 202 555-0199',
        verifiedName: 'Docmee',
        platform: 'CLOUD_API',
        status: 'CONNECTED',
      },
      waba: { id: '1485673640028042', containsPhone: true },
    })
    expect(channelStore.created).toBeNull()
    expect(response.body).not.toContain('meta-token')
  })

  it('rejects a new manual account when the phone is not in the selected WABA', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: '1220622364468433' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '1110868878787660' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'PUT',
      url: '/clinics/c-1/channels/whatsapp',
      headers: clinicAdminAuth,
      payload: {
        accountId: '1220622364468433',
        wabaId: '1485673640028042',
        accessToken: 'meta-token',
        webhookVerifyToken: 'docmee-test-verify-token',
        status: 'active',
      },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain('phone number was not found')
    expect(channelStore.created).toBeNull()
    expect(response.body).not.toContain('meta-token')
  })

  it('persists a new manual WABA only after Meta validates ownership', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: '1220622364468433',
          display_phone_number: '+1 202 555-0199',
          verified_name: 'Docmee',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: '1220622364468433' }] }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'PUT',
      url: '/clinics/c-1/channels/whatsapp',
      headers: clinicAdminAuth,
      payload: {
        accountId: '1220622364468433',
        wabaId: '1485673640028042',
        displayName: 'Second clinic WABA',
        accessToken: 'meta-token',
        webhookVerifyToken: 'docmee-test-verify-token',
        status: 'active',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(channelStore.created).toMatchObject({
      clinicId: 'c-1',
      accountId: '1220622364468433',
      displayName: 'Second clinic WABA',
      accessTokenEnc: 'enc:meta-token',
      webhookVerifyToken: 'docmee-test-verify-token',
      settings: {
        provider: 'meta_whatsapp',
        wabaId: '1485673640028042',
      },
    })
    expect(response.body).not.toContain('meta-token')
  })

  it('rejects malformed PINs before any Meta request', async () => {
    addMetaAccount()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/channels/whatsapp/acc-1/register',
      headers: clinicAdminAuth,
      payload: { pin: '12345' },
    })

    expect(response.statusCode).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response.body).not.toContain('12345')
  })

  it('does not allow one clinic to register another clinic account', async () => {
    addMetaAccount()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/channels/whatsapp/acc-1/register',
      headers: foreignClinicAdminAuth,
      payload: { pin: '012345' },
    })

    expect(response.statusCode).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a clinic administrator role', async () => {
    addMetaAccount()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/channels/whatsapp/acc-1/register',
      headers: secretaryAuth,
      payload: { pin: '012345' },
    })

    expect(response.statusCode).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('verifies WABA ownership and registers the stored phone number through Meta', async () => {
    addMetaAccount()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'phone-1' }] }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true }) })
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/channels/whatsapp/acc-1/register',
      headers: clinicAdminAuth,
      payload: { pin: '012345' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ ok: true, phoneNumberId: 'phone-1' })
    expect(response.body).not.toContain('012345')
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ href: expect.stringContaining('/phone-1/register') }),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messaging_product: 'whatsapp', pin: '012345' }),
      }),
    )
  })

  it('returns Meta registration details and a useful retry action without echoing the PIN', async () => {
    addMetaAccount()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: 'phone-1' }] }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({
          error: { message: 'Incorrect two-step verification PIN', code: 100, error_subcode: 33 },
        }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const response = await app.inject({
      method: 'POST',
      url: '/clinics/c-1/channels/whatsapp/acc-1/register',
      headers: clinicAdminAuth,
      payload: { pin: '654321' },
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toMatchObject({
      error: 'Incorrect two-step verification PIN',
      metaCode: 100,
      metaSubcode: 33,
      action: expect.stringContaining('two-step verification PIN'),
    })
    expect(response.body).not.toContain('654321')
  })
})
