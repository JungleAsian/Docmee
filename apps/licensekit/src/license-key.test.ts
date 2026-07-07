import { describe, it, expect } from 'vitest'
import { generateKeyPair } from './crypto.js'
import {
  generateLicenseKey,
  parseLicenseKey,
  decodeLicensePayload,
  type LicensePayload,
} from './license-key.js'

const keys = generateKeyPair()

function payload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    clinicName: 'Test Clinic',
    seats: 3,
    expiresAt: '2099-01-01T00:00:00.000Z',
    issuedAt: '2026-01-01T00:00:00.000Z',
    licenseId: '11111111-1111-1111-1111-111111111111',
    ...overrides,
  }
}

describe('license-key', () => {
  it('generate + parse round-trips the payload', () => {
    const key = generateLicenseKey(payload(), keys.privateKey)
    expect(parseLicenseKey(key, keys.publicKey)).toEqual(payload())
  })

  it('a tampered key returns null', () => {
    const key = generateLicenseKey(payload(), keys.privateKey)
    const [b64] = key.split('.')
    const forged = Buffer.from(
      JSON.stringify(payload({ seats: 9999 })),
      'utf8',
    ).toString('base64')
    // Swap the payload but keep the original signature → must fail verification.
    const tampered = `${forged}.${key.slice(b64!.length + 1)}`
    expect(parseLicenseKey(tampered, keys.publicKey)).toBeNull()
  })

  it('a malformed key (no signature) returns null', () => {
    expect(parseLicenseKey('not-a-license-key', keys.publicKey)).toBeNull()
  })

  it('an expired key still parses and surfaces its past expiry date', () => {
    const expiresAt = '2020-01-01T00:00:00.000Z'
    const key = generateLicenseKey(payload({ expiresAt }), keys.privateKey)
    const parsed = parseLicenseKey(key, keys.publicKey)
    expect(parsed?.expiresAt).toBe(expiresAt)
    expect(Date.parse(parsed!.expiresAt)).toBeLessThan(Date.now())
  })

  it('decodeLicensePayload reads the payload without verifying the signature', () => {
    const key = generateLicenseKey(payload(), keys.privateKey)
    const tampered = `${key.split('.')[0]}.deadbeef`
    // parse (verifies) rejects it, decode (trusts) still reads it.
    expect(parseLicenseKey(tampered, keys.publicKey)).toBeNull()
    expect(decodeLicensePayload(tampered)).toEqual(payload())
  })
})
