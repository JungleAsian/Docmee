import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Gap #36 — pure scheduling / gate logic for the hourly reports tick.
//
// reports-deliver.worker.test.ts already covers the happy-path dual delivery
// (email + persist) and the emailed=false fallbacks. This file locks the GATES
// that decide WHETHER a clinic gets a report on a given tick: the daily window
// fires only at clinic-local 08:00, the weekly window only on Monday 09:00,
// inactive clinics are skipped, each clinic is gated against its OWN timezone,
// and a persist failure for one clinic never aborts the rest of the fan-out.

const captures = vi.hoisted(() => ({
  emails: [] as { to: string; subject: string }[],
  created: [] as Record<string, unknown>[],
  // Mutable so each test can shape the clinic set (status, timezone, count).
  clinics: [] as { id: string; name: string; status: string; timezone: string }[],
  createShouldThrow: false,
}))

vi.mock('@docmee/notifications', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string }) => {
    captures.emails.push({ to: p.to, subject: p.subject })
  }),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    list: async () => captures.clinics,
  }),
  createUsersRepository: () => ({
    findPrimaryEmail: async () => 'admin@clinic.test',
  }),
  createMetricsRepository: () => ({
    dashboard: async () => ({
      conversationsToday: 4,
      messagesToday: 18,
      botReplyRate: 0.75,
      avgResponseSeconds: 42,
      conversationsPerDay: [],
    }),
  }),
  createAppointmentsRepository: () => ({
    countCreatedBetween: async () => 2,
  }),
  createReportsRepository: () => ({
    // Record the attempt FIRST so persist-failure tests can still assert the
    // worker reached every clinic, then optionally simulate a table hiccup.
    create: async (row: Record<string, unknown>) => {
      captures.created.push(row)
      if (captures.createShouldThrow) throw new Error('reports table down')
      return { id: `gen-${captures.created.length}`, ...row }
    },
  }),
}))

import { localTimeIn, processReportsJob } from '../reports.worker.js'

const job = {} as Parameters<typeof processReportsJob>[0]
const activeUtc = (id: string) => ({ id, name: `Clinic ${id}`, status: 'active', timezone: 'UTC' })

describe('localTimeIn — cross-timezone hour + weekday', () => {
  it('rolls the weekday back across the UTC day boundary (Mon UTC → Sun local)', () => {
    // 2026-06-15T02:00:00Z is Monday 02:00 UTC, but 20:00 on Sunday June 14 in
    // America/Guatemala (UTC-6).
    const instant = new Date('2026-06-15T02:00:00Z')
    expect(localTimeIn('UTC', instant)).toEqual({ hour: 2, dayOfWeek: 1 })
    expect(localTimeIn('America/Guatemala', instant)).toEqual({ hour: 20, dayOfWeek: 0 })
  })

  it('rolls the weekday forward across the boundary for an east-of-UTC zone', () => {
    // 2026-06-15T23:00:00Z is Monday 23:00 UTC, but Tuesday 08:00 in Tokyo (UTC+9).
    const instant = new Date('2026-06-15T23:00:00Z')
    expect(localTimeIn('Asia/Tokyo', instant)).toEqual({ hour: 8, dayOfWeek: 2 })
  })
})

describe('processReportsJob — schedule gates (Gap #36)', () => {
  beforeEach(() => {
    captures.emails = []
    captures.created = []
    captures.clinics = [activeUtc('c-1')]
    captures.createShouldThrow = false
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does not fire the daily report one hour before the window (07:00)', async () => {
    vi.setSystemTime(new Date('2026-06-16T07:00:00Z')) // Tuesday 07:00
    await processReportsJob(job)
    expect(captures.created).toHaveLength(0)
  })

  it('does not fire the daily report one hour after the window (09:00, non-Monday)', async () => {
    vi.setSystemTime(new Date('2026-06-16T09:00:00Z')) // Tuesday 09:00 — daily hour passed, not Monday
    await processReportsJob(job)
    expect(captures.created).toHaveLength(0)
  })

  it('fires only the daily report at 08:00 (never the weekly)', async () => {
    vi.setSystemTime(new Date('2026-06-15T08:00:00Z')) // Monday 08:00 — daily hour, not weekly hour
    await processReportsJob(job)
    expect(captures.created.map((r) => r['type'])).toEqual(['daily'])
  })

  it('does not fire the weekly report at 09:00 on a non-Monday', async () => {
    vi.setSystemTime(new Date('2026-06-16T09:00:00Z')) // Tuesday 09:00
    await processReportsJob(job)
    expect(captures.created).toHaveLength(0)
  })

  it('fires only the weekly report on Monday 09:00 (never the daily)', async () => {
    vi.setSystemTime(new Date('2026-06-15T09:00:00Z')) // Monday 09:00
    await processReportsJob(job)
    expect(captures.created.map((r) => r['type'])).toEqual(['weekly'])
  })

  it('skips inactive clinics inside the daily window', async () => {
    captures.clinics = [{ id: 'c-1', name: 'Paused', status: 'inactive', timezone: 'UTC' }]
    vi.setSystemTime(new Date('2026-06-16T08:00:00Z'))
    await processReportsJob(job)
    expect(captures.created).toHaveLength(0)
    expect(captures.emails).toHaveLength(0)
  })

  it('gates each clinic against its OWN timezone (only the one at local 08:00 fires)', async () => {
    captures.clinics = [
      { id: 'utc', name: 'UTC Clinic', status: 'active', timezone: 'UTC' },
      { id: 'gt', name: 'GT Clinic', status: 'active', timezone: 'America/Guatemala' },
    ]
    vi.setSystemTime(new Date('2026-06-16T08:00:00Z')) // 08:00 UTC == 02:00 in Guatemala
    await processReportsJob(job)
    expect(captures.created).toHaveLength(1)
    expect(captures.created[0]!['clinicId']).toBe('utc')
  })

  it('continues the fan-out when one clinic fails to persist (best-effort, never aborts)', async () => {
    captures.clinics = [activeUtc('c-1'), activeUtc('c-2')]
    captures.createShouldThrow = true
    vi.setSystemTime(new Date('2026-06-16T08:00:00Z'))
    // The persist throws for BOTH clinics yet processReportsJob resolves and still
    // reaches every clinic — the swallowed error must not abort the loop.
    await expect(processReportsJob(job)).resolves.toBeUndefined()
    expect(captures.created.map((r) => r['clinicId'])).toEqual(['c-1', 'c-2'])
  })
})
