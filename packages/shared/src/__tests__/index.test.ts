import { describe, it, expect } from 'vitest'
import { ok, err, hashPassword, verifyPassword } from '../index.js'

describe('@docmee/shared', () => {
  it('ok() wraps a value', () => {
    const result = ok(42)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe(42)
  })

  it('err() wraps an error', () => {
    const result = err(new Error('fail'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toBe('fail')
  })

  describe('password hashing', () => {
    it('verifies a correct password and rejects a wrong one', () => {
      const hash = hashPassword('correct horse battery staple')
      expect(hash.startsWith('scrypt$')).toBe(true)
      expect(verifyPassword('correct horse battery staple', hash)).toBe(true)
      expect(verifyPassword('wrong password', hash)).toBe(false)
    })

    it('uses a fresh salt per hash', () => {
      expect(hashPassword('same')).not.toBe(hashPassword('same'))
    })

    it('rejects a malformed stored hash', () => {
      expect(verifyPassword('x', 'not-a-valid-hash')).toBe(false)
    })
  })
})
