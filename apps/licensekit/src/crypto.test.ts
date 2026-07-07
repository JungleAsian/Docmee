import { describe, it, expect } from 'vitest'
import { generateKeyPair, signPayload, verifySignature } from './crypto.js'

describe('crypto (Ed25519)', () => {
  it('generateKeyPair returns PEM-encoded keys', () => {
    const { privateKey, publicKey } = generateKeyPair()
    expect(privateKey).toContain('BEGIN PRIVATE KEY')
    expect(publicKey).toContain('BEGIN PUBLIC KEY')
  })

  it('sign + verify round-trips', () => {
    const { privateKey, publicKey } = generateKeyPair()
    const signature = signPayload('hello-license', privateKey)
    expect(verifySignature('hello-license', signature, publicKey)).toBe(true)
  })

  it('verify with the wrong key returns false', () => {
    const a = generateKeyPair()
    const b = generateKeyPair()
    const signature = signPayload('payload', a.privateKey)
    expect(verifySignature('payload', signature, b.publicKey)).toBe(false)
  })

  it('verify of a tampered payload returns false', () => {
    const { privateKey, publicKey } = generateKeyPair()
    const signature = signPayload('payload', privateKey)
    expect(verifySignature('payload-tampered', signature, publicKey)).toBe(false)
  })

  it('verify with a malformed public key returns false instead of throwing', () => {
    const { privateKey } = generateKeyPair()
    const signature = signPayload('payload', privateKey)
    expect(verifySignature('payload', signature, 'not-a-key')).toBe(false)
  })
})
