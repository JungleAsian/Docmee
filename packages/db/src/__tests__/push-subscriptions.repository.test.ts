import { describe, it, expect } from 'vitest'
import { createPushSubscriptionsRepository } from '../repositories/push-subscriptions.repository.js'
import type { Sql } from '../client.js'

// Tagged-template stand-in for postgres.js (see reports.repository.test.ts).
function fakeSql(rows: Record<string, unknown>[]): { sql: Sql; calls: { q: string; values: unknown[] }[] } {
  const calls: { q: string; values: unknown[] }[] = []
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ q: strings.join(' '), values })
    return Promise.resolve(rows)
  }) as unknown as Sql
  return { sql: fn, calls }
}

const ROW = {
  id: 'p-1',
  clinicId: 'c-1',
  userId: 'u-1',
  userEmail: 'sec@clinic.test',
  endpoint: 'https://push.example.com/sub/abc',
  p256dh: 'BPpub',
  auth: 'authsecret',
  createdAt: '2026-06-19T10:00:00.000Z',
  updatedAt: '2026-06-19T10:00:00.000Z',
}

describe('createPushSubscriptionsRepository', () => {
  it('upsert binds every column and conflicts on endpoint', async () => {
    const { sql, calls } = fakeSql([ROW])
    const repo = createPushSubscriptionsRepository(sql)
    const out = await repo.upsert({
      clinicId: 'c-1',
      userId: 'u-1',
      userEmail: 'sec@clinic.test',
      endpoint: ROW.endpoint,
      p256dh: 'BPpub',
      auth: 'authsecret',
    })
    expect(out.id).toBe('p-1')
    expect(calls[0]!.q).toContain('INSERT INTO push_subscriptions')
    expect(calls[0]!.q).toContain('ON CONFLICT (endpoint) DO UPDATE')
    expect(calls[0]!.values).toEqual(['c-1', 'u-1', 'sec@clinic.test', ROW.endpoint, 'BPpub', 'authsecret'])
  })

  it('listByRecipient scopes by clinic + email', async () => {
    const { sql, calls } = fakeSql([ROW])
    const repo = createPushSubscriptionsRepository(sql)
    const out = await repo.listByRecipient('c-1', 'sec@clinic.test')
    expect(out).toHaveLength(1)
    expect(calls[0]!.q).toContain('WHERE clinic_id =')
    expect(calls[0]!.q).toContain('user_email =')
    expect(calls[0]!.values).toEqual(['c-1', 'sec@clinic.test'])
  })

  it('deleteByEndpoint is owner-scoped and returns true when a row matched', async () => {
    const { sql, calls } = fakeSql([{ id: 'p-1' }])
    const repo = createPushSubscriptionsRepository(sql)
    expect(await repo.deleteByEndpoint('u-1', ROW.endpoint)).toBe(true)
    expect(calls[0]!.q).toContain('DELETE FROM push_subscriptions')
    expect(calls[0]!.q).toContain('user_id =')
    expect(calls[0]!.values).toEqual(['u-1', ROW.endpoint])
  })

  it('deleteByEndpoint returns false when nothing matched', async () => {
    const { sql } = fakeSql([])
    const repo = createPushSubscriptionsRepository(sql)
    expect(await repo.deleteByEndpoint('u-1', 'missing')).toBe(false)
  })

  it('pruneEndpoint deletes regardless of owner', async () => {
    const { sql, calls } = fakeSql([{ id: 'p-1' }])
    const repo = createPushSubscriptionsRepository(sql)
    expect(await repo.pruneEndpoint(ROW.endpoint)).toBe(true)
    expect(calls[0]!.q).toContain('DELETE FROM push_subscriptions')
    expect(calls[0]!.values).toEqual([ROW.endpoint])
  })
})
