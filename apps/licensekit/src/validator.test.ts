import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { checkLicense, enforceLicenseGate, type LicenseState } from './validator.js'

const CLINIC = '22222222-2222-2222-2222-222222222222'

/** Stub the license server's /validate response. */
function stubServer(state: LicenseState, ok = true) {
  process.env['LICENSE_SERVER_URL'] = 'http://license.test'
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => ({ state }) }) as unknown as Response),
  )
}

describe('validator', () => {
  beforeEach(() => {
    delete process.env['LICENSE_SERVER_URL']
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env['LICENSE_SERVER_URL']
  })

  describe('checkLicense', () => {
    it('returns unreachable when no server URL is configured', async () => {
      expect(await checkLicense(CLINIC)).toBe('unreachable')
    })

    it('returns unreachable when the request fails', async () => {
      process.env['LICENSE_SERVER_URL'] = 'http://license.test'
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
      expect(await checkLicense(CLINIC)).toBe('unreachable')
    })

    it('returns invalid on a non-2xx response', async () => {
      stubServer('valid', false)
      expect(await checkLicense(CLINIC)).toBe('invalid')
    })

    it('passes through the server-reported state', async () => {
      stubServer('valid')
      expect(await checkLicense(CLINIC)).toBe('valid')
    })
  })

  describe('enforceLicenseGate', () => {
    it('throws for a new activation when the license is expired', async () => {
      stubServer('expired')
      await expect(enforceLicenseGate(CLINIC, true)).rejects.toThrow(/expired/i)
    })

    it('throws for a new activation when the license is invalid', async () => {
      stubServer('invalid')
      await expect(enforceLicenseGate(CLINIC, true)).rejects.toThrow(/invalid/i)
    })

    it('allows a new activation when the license is valid', async () => {
      stubServer('valid')
      await expect(enforceLicenseGate(CLINIC, true)).resolves.toBeUndefined()
    })

    it('allows a new activation when the server is unreachable (fail open)', async () => {
      await expect(enforceLicenseGate(CLINIC, true)).resolves.toBeUndefined()
    })

    it('NEVER interrupts a running clinic, regardless of license state', async () => {
      const fetchSpy = vi.fn(async () => ({ ok: true, json: async () => ({ state: 'expired' }) }) as unknown as Response)
      process.env['LICENSE_SERVER_URL'] = 'http://license.test'
      vi.stubGlobal('fetch', fetchSpy)

      for (const state of ['valid', 'expired', 'invalid', 'unreachable'] as const) {
        void state
        await expect(enforceLicenseGate(CLINIC, false)).resolves.toBeUndefined()
      }
      // A running clinic must not even phone home.
      expect(fetchSpy).not.toHaveBeenCalled()
    })
  })
})
