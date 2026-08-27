import { describe, expect, it, vi } from 'vitest'
import type { Sql } from '../client.js'
import { createAppointmentsRepository } from '../repositories/appointments.repository.js'

function transactionalSql() {
  let count = 0
  let sequence = Promise.resolve()
  const statements: string[] = []
  const tx = Object.assign(
    vi.fn((strings: TemplateStringsArray) => {
      const statement = strings.join('?').replace(/\s+/g, ' ').trim()
      statements.push(statement)
      if (statement.includes('SELECT COUNT(*)')) return Promise.resolve([{ count: String(count) }])
      if (statement.includes('INSERT INTO appointments')) {
        count += 1
        return Promise.resolve([{
          id: `appt-${count}`,
          clinicId: 'clinic-1',
          patientId: 'patient-1',
          doctorId: 'doctor-1',
          status: 'pending',
          startTime: '2026-09-07T09:00:00',
          endTime: '2026-09-07T09:30:00',
        }])
      }
      return Promise.resolve([])
    }),
    { json: (value: unknown) => value },
  )
  const sql = Object.assign(vi.fn(), {
    json: (value: unknown) => value,
    begin: <T>(callback: (transaction: typeof tx) => Promise<T>) => {
      const run = sequence.then(() => callback(tx))
      sequence = run.then(() => undefined, () => undefined)
      return run
    },
  }) as unknown as Sql
  return { sql, statements, getCount: () => count }
}

describe('AppointmentsRepository.createWithinCapacity', () => {
  it('serializes concurrent overlapping bookings and creates only one ordinary appointment', async () => {
    const fake = transactionalSql()
    const repository = createAppointmentsRepository(fake.sql)
    const input = {
      clinicId: 'clinic-1',
      patientId: 'patient-1',
      doctorId: 'doctor-1',
      startTime: '2026-09-07T09:00:00',
      endTime: '2026-09-07T09:30:00',
      capacity: 2,
      allowOverbooking: false,
    }

    const results = await Promise.all([
      repository.createWithinCapacity(input),
      repository.createWithinCapacity(input),
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: 'clash', clashCount: 1 },
    ])
    expect(fake.getCount()).toBe(1)
    expect(fake.statements.some((statement) => statement.includes('pg_advisory_xact_lock'))).toBe(true)
  })
})
