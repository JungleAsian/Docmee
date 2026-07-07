import { describe, it, expect } from 'vitest'
import { createReportsRepository } from '../repositories/reports.repository.js'
import type { Sql } from '../client.js'

// A tagged-template stand-in for postgres.js: routes by the SQL verb so we can
// assert the repository's binding/clamping without a DB. `calls` captures the
// interpolated values of each query for assertions.
function fakeSql(rows: Record<string, unknown>[]): { sql: Sql; calls: { q: string; values: unknown[] }[] } {
  const calls: { q: string; values: unknown[] }[] = []
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ q: strings.join(' '), values })
    return Promise.resolve(rows)
  }) as unknown as Sql
  ;(fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v
  return { sql: fn, calls }
}

const ROW = {
  id: 'r-1',
  clinicId: 'c-1',
  type: 'daily',
  periodStart: '2026-06-18T08:00:00.000Z',
  periodEnd: '2026-06-19T08:00:00.000Z',
  subject: 'Clinic: daily report',
  html: '<h2>Report</h2>',
  data: { conversations: 4 },
  recipientEmail: 'admin@clinic.test',
  emailed: true,
  createdAt: '2026-06-19T08:00:00.000Z',
}

describe('createReportsRepository', () => {
  it('create binds every column and returns the inserted row', async () => {
    const { sql, calls } = fakeSql([ROW])
    const repo = createReportsRepository(sql)
    const out = await repo.create({
      clinicId: 'c-1',
      type: 'daily',
      periodStart: ROW.periodStart,
      periodEnd: ROW.periodEnd,
      subject: ROW.subject,
      html: ROW.html,
      data: { conversations: 4 },
      recipientEmail: 'admin@clinic.test',
      emailed: true,
    })
    expect(out.id).toBe('r-1')
    expect(calls[0]!.q).toContain('INSERT INTO generated_reports')
    // clinicId, type, periodStart, periodEnd, subject, html, <json>, recipient, emailed
    expect(calls[0]!.values).toEqual([
      'c-1',
      'daily',
      ROW.periodStart,
      ROW.periodEnd,
      ROW.subject,
      ROW.html,
      { conversations: 4 },
      'admin@clinic.test',
      true,
    ])
  })

  it('create defaults emailed=false, recipient=null and data={}', async () => {
    const { sql, calls } = fakeSql([ROW])
    await createReportsRepository(sql).create({
      clinicId: 'c-1',
      type: 'weekly',
      periodStart: ROW.periodStart,
      periodEnd: ROW.periodEnd,
      subject: 'x',
      html: '<p/>',
    })
    expect(calls[0]!.values).toEqual(['c-1', 'weekly', ROW.periodStart, ROW.periodEnd, 'x', '<p/>', {}, null, false])
  })

  it('listByClinic clamps the limit into 1..200', async () => {
    const { sql, calls } = fakeSql([ROW])
    await createReportsRepository(sql).listByClinic('c-1', 9999)
    expect(calls[0]!.q).toContain('FROM generated_reports')
    expect(calls[0]!.values).toEqual(['c-1', 200])
  })

  it('findById returns null when the report is absent or foreign', async () => {
    const { sql } = fakeSql([])
    const out = await createReportsRepository(sql).findById('c-1', 'missing')
    expect(out).toBeNull()
  })

  it('findById returns the clinic-scoped row', async () => {
    const { sql, calls } = fakeSql([ROW])
    const out = await createReportsRepository(sql).findById('c-1', 'r-1')
    expect(out?.id).toBe('r-1')
    expect(calls[0]!.values).toEqual(['c-1', 'r-1'])
  })
})
