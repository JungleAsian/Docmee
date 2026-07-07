import { describe, it, expect } from 'vitest'
import { createHmac } from 'node:crypto'
import { validateHmacSignature } from '../lib/hmac.js'

const secret = 'test-secret'
const body = Buffer.from(JSON.stringify({ hello: 'world' }))
const sign = (b: Buffer, s: string) => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`

describe('validateHmacSignature', () => {
  it('returns true for a valid signature', () => {
    expect(validateHmacSignature(body, sign(body, secret), secret)).toBe(true)
  })

  it('returns false for a wrong secret', () => {
    expect(validateHmacSignature(body, sign(body, 'other-secret'), secret)).toBe(false)
  })

  it('returns false when the signature is missing', () => {
    expect(validateHmacSignature(body, undefined, secret)).toBe(false)
  })

  it('returns false when the secret is empty', () => {
    expect(validateHmacSignature(body, sign(body, secret), '')).toBe(false)
  })

  it('returns false for a length-mismatched signature (no throw)', () => {
    expect(validateHmacSignature(body, 'sha256=deadbeef', secret)).toBe(false)
  })
})
