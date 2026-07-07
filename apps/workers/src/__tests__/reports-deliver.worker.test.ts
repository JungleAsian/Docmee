import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Req 37 — verify processReportsJob delivers through BOTH channels: it emails the
// clinic admin AND persists the report so the panel can show it, recording whether
// the email actually went out (emailed flag).

const captures = vi.hoisted(() => ({
  emails: [] as { to: string; subject: string }[],
  created: [] as Record<string, unknown>[],
  emailShouldThrow: false,
  recipient: 'admin@clinic.test' as string | null,
}))

vi.mock('@docmee/notifications', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string }) => {
    if (captures.emailShouldThrow) throw new Error('resend down')
    captures.emails.push({ to: p.to, subject: p.subject })
  }),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    list: async () => [{ id: 'c-1', name: 'Clinica Demo', status: 'active', timezone: 'UTC' }],
  }),
  createUsersRepository: () => ({
    findPrimaryEmail: async () => captures.recipient,
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
    create: async (row: Record<string, unknown>) => {
      captures.created.push(row)
      return { id: `gen-${captures.created.length}`, ...row }
    },
  }),
}))

import { processReportsJob } from '../reports.worker.js'

const job = {} as Parameters<typeof processReportsJob>[0]

describe('processReportsJob — panel + email delivery (Req 37)', () => {
  beforeEach(() => {
    captures.emails = []
    captures.created = []
    captures.emailShouldThrow = false
    captures.recipient = 'admin@clinic.test'
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('at clinic-local 08:00 emails AND persists a daily report (emailed=true)', async () => {
    vi.setSystemTime(new Date('2026-06-16T08:00:00Z')) // Tuesday 08:00 UTC
    await processReportsJob(job)

    expect(captures.emails).toHaveLength(1)
    expect(captures.emails[0]!.subject).toBe('Clinica Demo: daily report')

    expect(captures.created).toHaveLength(1)
    const row = captures.created[0]!
    expect(row['type']).toBe('daily')
    expect(row['clinicId']).toBe('c-1')
    expect(row['emailed']).toBe(true)
    expect(row['recipientEmail']).toBe('admin@clinic.test')
    expect(String(row['html'])).toContain('Daily report')
    expect((row['data'] as { bookings: number }).bookings).toBe(2)
  })

  it('on a Monday 09:00 emails AND persists a weekly report', async () => {
    vi.setSystemTime(new Date('2026-06-15T09:00:00Z')) // Monday 09:00 UTC
    await processReportsJob(job)

    expect(captures.created).toHaveLength(1)
    expect(captures.created[0]!['type']).toBe('weekly')
    expect(captures.emails[0]!.subject).toBe('Clinica Demo: weekly report')
  })

  it('still persists the report (emailed=false) when the email send fails', async () => {
    vi.setSystemTime(new Date('2026-06-16T08:00:00Z'))
    captures.emailShouldThrow = true
    await processReportsJob(job)

    expect(captures.created).toHaveLength(1)
    expect(captures.created[0]!['emailed']).toBe(false)
  })

  it('persists a panel-only report (no email) when the clinic has no admin recipient', async () => {
    vi.setSystemTime(new Date('2026-06-16T08:00:00Z'))
    captures.recipient = null
    await processReportsJob(job)

    expect(captures.emails).toHaveLength(0)
    expect(captures.created).toHaveLength(1)
    expect(captures.created[0]!['emailed']).toBe(false)
    expect(captures.created[0]!['recipientEmail']).toBeNull()
  })

  it('skips clinics outside the daily/weekly send windows', async () => {
    vi.setSystemTime(new Date('2026-06-16T13:00:00Z')) // Tuesday 13:00 — neither window
    await processReportsJob(job)
    expect(captures.created).toHaveLength(0)
    expect(captures.emails).toHaveLength(0)
  })
})
