import Fastify from 'fastify'
import { afterEach, afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const channelStore = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
}))

vi.mock('@docmee/db', () => ({
  createChannelAccountsRepository: () => ({
    listByClinic: async (clinicId: string) =>
      channelStore.accounts.filter((account) => account.clinicId === clinicId),
    create: vi.fn(),
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
  const clinicAdminAuth = {
    authorization: `Bearer ${signAccessToken({
      userId: 'admin-1',
      clinicId: 'c-1',
      role: 'clinic_admin',
      email: 'admin@clinic.test',
    })}`,
  }
  const foreignClinicAdminAuth = {
    authorization: `Bearer ${signAccessToken({
      userId: 'admin-2',
      clinicId: 'c-2',
      role: 'clinic_admin',
      email: 'admin@other.test',
    })}`,
  }
  const secretaryAuth = {
    authorization: `Bearer ${signAccessToken({
      userId: 'staff-1',
      clinicId: 'c-1',
      role: 'secretary',
      email: 'staff@clinic.test',
    })}`,
  }

  beforeAll(async () => {
    app = Fastify()
    await app.register(channelsRoute)
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  afterEach(() => {
    channelStore.accounts = []
    vi.unstubAllGlobals()
  })

  function addMetaAccount() {
    channelStore.accounts = [{
      ...baseAccount,
      accessTokenEnc: 'enc:live-token',
      settings: { ...baseAccount.settings, wabaId: 'waba-1' },
    }]
  }

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
