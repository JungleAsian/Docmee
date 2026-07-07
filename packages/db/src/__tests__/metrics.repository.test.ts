import { describe, it, expect } from 'vitest'
import { createMetricsRepository } from '../repositories/metrics.repository.js'
import type { Sql } from '../client.js'

// A tagged-template stand-in for postgres.js: it inspects each query's text and
// returns canned rows so we can assert the dashboard's post-processing math
// (rates, conversion, channel/peak mapping) without a live database.
function fakeSql(): Sql {
  const fn = ((strings: TemplateStringsArray) => {
    const q = strings.join(' ')
    // Screen 14: bot/human/urgent split and the period-over-period baseline. Checked
    // before the broad 'JOIN appointments' branch so the previous-window LEFT JOIN
    // doesn't get mistaken for the bookings count query.
    if (q.includes('AS is_urgent')) return Promise.resolve([{ urgent: '6', human: '23', bot: '71' }])
    if (q.includes('LEFT JOIN appointments')) return Promise.resolve([{ total: '8', bookings: '3' }])
    if (q.includes('JOIN appointments')) return Promise.resolve([{ count: '4' }])
    if (q.includes('AS transferred')) return Promise.resolve([{ total: '10', transferred: '3', leads: '7' }])
    if (q.includes('GROUP BY channel')) {
      return Promise.resolve([
        { channel: 'whatsapp', count: '6' },
        { channel: 'messenger', count: '3' },
        { channel: 'instagram', count: '1' },
      ])
    }
    if (q.includes('with_inbound')) return Promise.resolve([{ withInbound: '8', noResponse: '2' }])
    if (q.includes('EXTRACT(DOW')) {
      return Promise.resolve([
        { dow: '1', hour: '9', count: '5' },
        { dow: '3', hour: '14', count: '2' },
      ])
    }
    if (q.includes('lastIntent')) return Promise.resolve([{ intent: 'booking', count: '4' }])
    if (q.includes('AS inbound')) return Promise.resolve([{ inbound: '5', replies: '4' }])
    if (q.includes('avg_seconds')) return Promise.resolve([{ avgSeconds: '42' }])
    if (q.includes("to_char(date_trunc('day'")) return Promise.resolve([{ date: '2026-06-01', count: '3' }])
    if (q.includes('FROM conversation_messages')) return Promise.resolve([{ count: '20' }]) // messages today
    if (q.includes('FROM conversations')) return Promise.resolve([{ count: '2' }]) // conversations today
    return Promise.resolve([])
  }) as unknown as Sql
  return fn
}

describe('metrics.repository — dashboard (Req 17 basic metrics)', () => {
  it('computes the full basic-metrics list from the aggregate queries', async () => {
    const dashboard = await createMetricsRepository(fakeSql()).dashboard('clinic-1', 'UTC')

    // Today's activity (pre-existing).
    expect(dashboard.conversationsToday).toBe(2)
    expect(dashboard.messagesToday).toBe(20)
    expect(dashboard.botReplyRate).toBeCloseTo(4 / 5)
    expect(dashboard.avgResponseSeconds).toBe(42)

    // Trailing-30-day list (Req 17).
    expect(dashboard.totalConversations).toBe(10)
    expect(dashboard.leads).toBe(7)
    expect(dashboard.bookings).toBe(4)
    expect(dashboard.bookingConversionRate).toBeCloseTo(0.4) // 4 / 10
    expect(dashboard.transferRate).toBeCloseTo(0.3) // 3 / 10
    expect(dashboard.noResponseRate).toBeCloseTo(0.25) // 2 / 8

    expect(dashboard.conversationsByChannel).toEqual([
      { channel: 'whatsapp', count: 6 },
      { channel: 'messenger', count: 3 },
      { channel: 'instagram', count: 1 },
    ])
    expect(dashboard.peakHours).toEqual([
      { dayOfWeek: 1, hour: 9, count: 5 },
      { dayOfWeek: 3, hour: 14, count: 2 },
    ])
    expect(dashboard.topIntents).toEqual([{ intent: 'booking', count: 4 }])

    // Screen 14 additions.
    expect(dashboard.bookingsToday).toBe(4)
    expect(dashboard.resolutionSplit).toEqual({ bot: 71, human: 23, urgent: 6 })
    expect(dashboard.previous).toEqual({ totalConversations: 8, bookings: 3 })
  })

  it('threads the window (period filter) through to the trailing-window queries as a bind value', async () => {
    const seen: unknown[][] = []
    const recordingSql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.push(values)
      return Promise.resolve([])
    }) as unknown as Sql

    await createMetricsRepository(recordingSql).dashboard('clinic-1', 'UTC', 7)
    const all = seen.flat()
    // The only numeric bind in the dashboard queries is the window, so its presence
    // confirms the period filter reaches make_interval(days => $n) rather than a literal.
    expect(all).toContain(7)
    expect(all).not.toContain(30)
  })

  it('clamps an out-of-range or non-finite window instead of injecting an unbounded interval', async () => {
    const seen: unknown[][] = []
    const recordingSql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.push(values)
      return Promise.resolve([])
    }) as unknown as Sql

    await createMetricsRepository(recordingSql).dashboard('clinic-1', 'UTC', 99999)
    expect(seen.flat()).toContain(365)

    seen.length = 0
    await createMetricsRepository(recordingSql).dashboard('clinic-1', 'UTC', Number.NaN)
    expect(seen.flat()).toContain(30) // falls back to the default
  })

  it('defaults to a 30-day window when none is supplied (backward compatible)', async () => {
    const seen: unknown[][] = []
    const recordingSql = ((_strings: TemplateStringsArray, ...values: unknown[]) => {
      seen.push(values)
      return Promise.resolve([])
    }) as unknown as Sql

    await createMetricsRepository(recordingSql).dashboard('clinic-1', 'UTC')
    expect(seen.flat()).toContain(30)
  })

  it('returns zeroed rates when there is no activity (no divide-by-zero)', async () => {
    const empty = (() => Promise.resolve([])) as unknown as Sql
    const dashboard = await createMetricsRepository(empty).dashboard('clinic-1', 'UTC')

    expect(dashboard.totalConversations).toBe(0)
    expect(dashboard.leads).toBe(0)
    expect(dashboard.bookings).toBe(0)
    expect(dashboard.bookingConversionRate).toBe(0)
    expect(dashboard.transferRate).toBe(0)
    expect(dashboard.noResponseRate).toBe(0)
    expect(dashboard.conversationsByChannel).toEqual([])
    expect(dashboard.peakHours).toEqual([])
    expect(dashboard.bookingsToday).toBe(0)
    expect(dashboard.resolutionSplit).toEqual({ bot: 0, human: 0, urgent: 0 })
    expect(dashboard.previous).toEqual({ totalConversations: 0, bookings: 0 })
  })
})
