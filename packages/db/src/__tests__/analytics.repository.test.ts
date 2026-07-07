import { describe, it, expect } from 'vitest'
import { createAnalyticsRepository } from '../repositories/analytics.repository.js'
import type { Sql } from '../client.js'

// Tagged-template stand-in for postgres.js: routes each query by a unique token in
// its text and returns canned rows so the advanced-analytics post-processing math
// (rates, automation, peak mapping) is asserted without a live database.
function fakeSql(): Sql {
  const fn = ((strings: TemplateStringsArray) => {
    const q = strings.join(' ')
    if (q.includes('AS automated')) {
      return Promise.resolve([{ total: '20', resolved: '12', handoff: '5', automated: '11', kbHit: '8' }])
    }
    if (q.includes('avg_length')) return Promise.resolve([{ avgLength: '4.25' }])
    if (q.includes('new_patients')) return Promise.resolve([{ newPatients: '7', returningPatients: '13' }])
    if (q.includes('EXTRACT(DOW')) {
      return Promise.resolve([
        { dow: '1', hour: '9', count: '5' },
        { dow: '4', hour: '16', count: '3' },
      ])
    }
    return Promise.resolve([])
  }) as unknown as Sql
  return fn
}

describe('analytics.repository — advanced (Req 40 advanced analytics)', () => {
  it('computes resolution / handoff / automation / kb-hit rates and the peak grid', async () => {
    const a = await createAnalyticsRepository(fakeSql()).advanced(
      'clinic-1',
      '2026-05-01T00:00:00.000Z',
      '2026-06-01T23:59:59.999Z',
      'UTC',
    )

    expect(a.totalConversations).toBe(20)
    expect(a.resolutionRate).toBeCloseTo(12 / 20)
    expect(a.handoffRate).toBeCloseTo(5 / 20)
    expect(a.automationRate).toBeCloseTo(11 / 20) // resolved with no handoff/assignment
    expect(a.kbHitRate).toBeCloseTo(8 / 20)
    expect(a.avgConversationLength).toBe(4.3) // rounded to one decimal
    expect(a.newPatients).toBe(7)
    expect(a.returningPatients).toBe(13)
    expect(a.peakHours).toEqual([
      { dayOfWeek: 1, hour: 9, count: 5 },
      { dayOfWeek: 4, hour: 16, count: 3 },
    ])
  })

  it('returns zeroed rates with no activity (no divide-by-zero)', async () => {
    const empty = (() => Promise.resolve([])) as unknown as Sql
    const a = await createAnalyticsRepository(empty).advanced('clinic-1', 'x', 'y', 'UTC')

    expect(a.totalConversations).toBe(0)
    expect(a.resolutionRate).toBe(0)
    expect(a.handoffRate).toBe(0)
    expect(a.automationRate).toBe(0)
    expect(a.kbHitRate).toBe(0)
    expect(a.avgConversationLength).toBe(0)
    expect(a.peakHours).toEqual([])
  })
})
