import { describe, it, expect } from 'vitest'
import { createMessageTemplatesRepository } from '../repositories/message-templates.repository.js'
import type { Sql } from '../client.js'

// Tagged-template stand-in for postgres.js (see push-subscriptions.repository.test.ts).
function fakeSql(rows: Record<string, unknown>[]): { sql: Sql; calls: { q: string; values: unknown[] }[] } {
  const calls: { q: string; values: unknown[] }[] = []
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ q: strings.join(' '), values })
    return Promise.resolve(rows)
  }) as unknown as Sql
  return { sql: fn, calls }
}

const APPROVED = {
  id: 'tpl-1',
  clinicId: 'c-1',
  name: 'appt_confirm',
  category: 'appointment_confirmation',
  language: 'es',
  body: 'Tu cita está confirmada.',
  status: 'approved',
  createdAt: '2026-06-19T10:00:00.000Z',
  updatedAt: '2026-06-19T10:00:00.000Z',
}

describe('createMessageTemplatesRepository — manual-send helpers (Rev1 #3)', () => {
  it('listApproved scopes by clinic + approved status', async () => {
    const { sql, calls } = fakeSql([APPROVED])
    const out = await createMessageTemplatesRepository(sql).listApproved('c-1')
    expect(out).toHaveLength(1)
    expect(calls[0]!.q).toContain("status = 'approved'")
    expect(calls[0]!.q).toContain('WHERE clinic_id =')
    expect(calls[0]!.values).toEqual(['c-1'])
  })

  it('findApprovedById binds clinic + id and only matches an approved row', async () => {
    const { sql, calls } = fakeSql([APPROVED])
    const out = await createMessageTemplatesRepository(sql).findApprovedById('c-1', 'tpl-1')
    expect(out?.id).toBe('tpl-1')
    expect(calls[0]!.q).toContain("status = 'approved'")
    expect(calls[0]!.values).toEqual(['c-1', 'tpl-1'])
  })

  it('findApprovedById returns null when no approved row matches', async () => {
    const { sql } = fakeSql([])
    const out = await createMessageTemplatesRepository(sql).findApprovedById('c-1', 'tpl-pending')
    expect(out).toBeNull()
  })
})
