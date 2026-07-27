import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Req 37 — verify processReportsJob delivers through BOTH channels: it emails the
// clinic admin AND persists the report so the panel can show it, recording whether
// the email actually went out (emailed flag).

const captures = vi.hoisted(() => ({
  emails: [] as { to: string; subject: string; idempotencyKey?: string }[],
  created: [] as Record<string, unknown>[],
  marked: [] as { id: string; emailed: boolean; diagnostic?: string | null }[],
  cleared: [] as { clinicId: string; successfulReportId: string }[],
  emailShouldThrow: false,
  recipient: 'admin@clinic.test' as string | null,
  settings: {} as Record<string, unknown>,
  controlledReport: null as Record<string, unknown> | null,
  claimOwners: [] as Array<string | null | undefined>,
}))

vi.mock('@docmee/notifications', () => ({
  sendEmail: vi.fn(async (p: { to: string; subject: string; idempotencyKey?: string }) => {
    if (captures.emailShouldThrow) throw new Error('resend down')
    captures.emails.push({ to: p.to, subject: p.subject, idempotencyKey: p.idempotencyKey })
  }),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({
    list: async () => [{ id: 'c-1', name: 'Clinica Demo', status: 'active', timezone: 'UTC', settings: captures.settings }],
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
    findById: async () => captures.controlledReport,
    claimScheduled: async (row: Record<string, unknown>) => {
      captures.created.push(row)
      return { id: `gen-${captures.created.length}`, ...row }
    },
    claimEmailDelivery: async (_id: string, claimOwner?: string | null) => {
      captures.claimOwners.push(claimOwner)
      return true
    },
    markEmailed: async (id: string, emailed: boolean, deliveryDiagnostic?: string | null) => {
      captures.marked.push({ id, emailed, diagnostic: deliveryDiagnostic })
      const index = Number(id.replace('gen-', '')) - 1
      if (Number.isInteger(index) && captures.created[index]) {
        captures.created[index]!['emailed'] = emailed
        captures.created[index]!['deliveryDiagnostic'] = deliveryDiagnostic ?? null
      }
    },
    clearHistoricalFailures: async (clinicId: string, successfulReportId: string) => {
      captures.cleared.push({ clinicId, successfulReportId })
      return 31
    },
  }),
}))

import { processReportsJob } from '../reports.worker.js'

const job = {} as Parameters<typeof processReportsJob>[0]

describe('processReportsJob — panel + email delivery (Req 37)', () => {
  beforeEach(() => {
    captures.emails = []
    captures.created = []
    captures.marked = []
    captures.cleared = []
    captures.emailShouldThrow = false
    captures.recipient = 'admin@clinic.test'
    captures.settings = {}
    captures.controlledReport = null
    captures.claimOwners = []
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

  it('uses the stable queue job id as the report delivery lease owner', async () => {
    vi.setSystemTime(new Date('2026-06-16T08:00:00Z'))
    await processReportsJob({ id: 'report-job-42' } as never)

    expect(captures.claimOwners).toEqual(['report-job-42'])
  })

  it('on a Monday 09:00 emails AND persists a weekly report', async () => {
    captures.settings = { reports: { frequency: 'weekly', hourLocal: 9 } }
    vi.setSystemTime(new Date('2026-06-15T09:00:00Z')) // Monday 09:00 UTC
    await processReportsJob(job)

    expect(captures.created).toHaveLength(1)
    expect(captures.created[0]!['type']).toBe('weekly')
    expect(captures.emails[0]!.subject).toBe('Clinica Demo: weekly report')
  })

  it('persists the failure and rejects so the durable queue retries it', async () => {
    vi.setSystemTime(new Date('2026-06-16T08:00:00Z'))
    captures.emailShouldThrow = true
    await expect(processReportsJob(job)).rejects.toThrow('resend down')

    expect(captures.created).toHaveLength(1)
    expect(captures.created[0]!['emailed']).toBe(false)
    expect(captures.created[0]!['deliveryDiagnostic']).toBe('provider_rejected_delivery')
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
    expect(captures.created).toHaveLength(1)
    expect(captures.emails).toHaveLength(1)
  })

  it('clears historical failures only after the controlled retry is accepted', async () => {
    captures.controlledReport = {
      id: 'report-32',
      clinicId: 'c-1',
      subject: 'Controlled report',
      html: '<p>report</p>',
      recipientEmail: 'admin@clinic.test',
    }

    await processReportsJob({
      data: {
        action: 'retry-report',
        clinicId: 'c-1',
        reportId: 'report-32',
        clearHistoricalFailures: true,
      },
    } as never)

    expect(captures.emails).toEqual([
      {
        to: 'admin@clinic.test',
        subject: 'Controlled report',
        idempotencyKey: 'controlled-report-retry:report-32',
      },
    ])
    expect(captures.marked).toContainEqual({ id: 'report-32', emailed: true, diagnostic: undefined })
    expect(captures.cleared).toEqual([{ clinicId: 'c-1', successfulReportId: 'report-32' }])
  })

  it('preserves historical failures when the controlled retry is rejected', async () => {
    captures.controlledReport = {
      id: 'report-32',
      clinicId: 'c-1',
      subject: 'Controlled report',
      html: '<p>report</p>',
      recipientEmail: 'admin@clinic.test',
    }
    captures.emailShouldThrow = true

    await expect(
      processReportsJob({
        data: {
          action: 'retry-report',
          clinicId: 'c-1',
          reportId: 'report-32',
          clearHistoricalFailures: true,
        },
      } as never),
    ).rejects.toThrow('Controlled report retry failed: provider_rejected_delivery')

    expect(captures.marked).toContainEqual({
      id: 'report-32',
      emailed: false,
      diagnostic: 'provider_rejected_delivery',
    })
    expect(captures.cleared).toHaveLength(0)
  })
})
