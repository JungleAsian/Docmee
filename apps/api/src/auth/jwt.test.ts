import { describe, it, expect, beforeAll } from 'vitest'
import { createSigner } from 'fast-jwt'
import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  type JwtPayload,
} from './jwt.js'

const payload: JwtPayload = {
  userId: 'u-1',
  clinicId: 'c-1',
  role: 'clinic_admin',
  email: 'admin@demo.test',
}

describe('jwt', () => {
  beforeAll(() => {
    process.env['JWT_SECRET'] = 'test-access-secret'
    process.env['JWT_REFRESH_SECRET'] = 'test-refresh-secret'
  })

  it('access sign + verify round-trips the payload', () => {
    const decoded = verifyAccessToken(signAccessToken(payload))
    expect(decoded.userId).toBe('u-1')
    expect(decoded.clinicId).toBe('c-1')
    expect(decoded.role).toBe('clinic_admin')
    expect(decoded.email).toBe('admin@demo.test')
  })

  it('refresh sign + verify round-trips the payload', () => {
    const decoded = verifyRefreshToken(signRefreshToken(payload))
    expect(decoded.userId).toBe('u-1')
  })

  it('expired token throws', () => {
    // Sign as if 20 minutes ago so the 15m access token is already expired.
    const past = Date.now() - 20 * 60 * 1000
    const expired = createSigner({
      key: 'test-access-secret',
      expiresIn: '15m',
      clockTimestamp: past,
    })(payload)
    expect(() => verifyAccessToken(expired)).toThrow()
  })

  it('token signed with the wrong secret throws', () => {
    const forged = createSigner({ key: 'not-the-secret' })(payload)
    expect(() => verifyAccessToken(forged)).toThrow()
  })
})
