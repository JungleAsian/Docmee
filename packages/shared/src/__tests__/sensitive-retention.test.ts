import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SENSITIVE_TRANSIENT_TTL_HOURS,
  SENSITIVE_TRANSIENT_RETENTION_POLICY,
  sensitiveTransientCutoff,
  sensitiveTransientExpiresAt,
} from '../sensitive-retention.js'

describe('sensitive transient data retention policy', () => {
  it('defaults temporary sensitive data to a hard 24-hour window', () => {
    expect(DEFAULT_SENSITIVE_TRANSIENT_TTL_HOURS).toBe(24)
    expect(SENSITIVE_TRANSIENT_RETENTION_POLICY).toBe('sensitive-transient-24h')
  })

  it('computes expiration and purge cutoff from the same 24-hour boundary', () => {
    const now = new Date('2026-09-08T15:30:00.000Z')
    const createdAt = new Date('2026-09-07T15:30:00.000Z')

    expect(sensitiveTransientExpiresAt(createdAt).toISOString()).toBe(now.toISOString())
    expect(sensitiveTransientCutoff(now).toISOString()).toBe(createdAt.toISOString())
  })
})
