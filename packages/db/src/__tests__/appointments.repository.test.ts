import { describe, expect, it, vi } from 'vitest'
import type { Sql } from '../client.js'
import { createAppointmentsRepository } from '../repositories/appointments.repository.js'

function transactionalSql(options: { externalClashes?: number } = {}) {
  let count = options.externalClashes ?? 0
  let sequence = Promise.resolve()
  const statements: string[] = []
  const appointment = {
    id: 'appt-current', clinicId: 'clinic-1', patientId: 'patient-1', providerId: null,
    doctorId: 'doctor-1', serviceId: null, conversationId: null, googleEventId: null,
    status: 'confirmed', startTime: '2026-09-07T09:00:00', endTime: '2026-09-07T09:30:00',
    notes: null, metadata: {}, calendarSyncPending: false, calendarSyncError: null,
    calendarSyncAttempts: 0, bookingOrigin: 'manual', actorId: null, overbooked: false,
    overbookingReason: null, providerCorrelationKey: null, createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  }
  const execute = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
    const statement = strings.join('?').replace(/\s+/g, ' ').trim()
    statements.push(statement)
    if (statement.includes('FOR UPDATE')) return Promise.resolve([appointment])
    if (statement.includes('SELECT COUNT(*)')) {
      const selfCount = statement.includes('id <>') ? 0 : 1
      return Promise.resolve([{ count: String(count + selfCount) }])
    }
    if (statement.includes('INSERT INTO appointments')) {
      count += 1
      return Promise.resolve([{ ...appointment, id: `appt-${count}`, status: 'pending' }])
    }
    if (statement.includes('UPDATE appointments')) {
      return Promise.resolve([{ ...appointment, startTime: '2026-09-07T10:00:00', endTime: '2026-09-07T10:30:00' }])
    }
    return Promise.resolve([])
  })
  const tx = Object.assign(execute, { json: (value: unknown) => value })
  const sql = Object.assign(vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => execute(strings, ...values)), {
    json: (value: unknown) => value,
    begin: <T>(callback: (transaction: typeof tx) => Promise<T>) => {
      const run = sequence.then(() => callback(tx))
      sequence = run.then(() => undefined, () => undefined)
      return run
    },
  }) as unknown as Sql
  return { sql, statements, getCount: () => count }
}

const createInput = {
  mode: 'create' as const,
  clinicId: 'clinic-1', patientId: 'patient-1', doctorId: 'doctor-1',
  startTime: '2026-09-07T09:00:00', endTime: '2026-09-07T09:30:00',
  capacity: 2, allowOverbooking: false,
}

describe('AppointmentsRepository.saveWithinCapacity', () => {
  it('serializes concurrent overlapping bookings and creates only one ordinary appointment', async () => {
    const fake = transactionalSql()
    const repository = createAppointmentsRepository(fake.sql)
    const results = await Promise.all([
      repository.saveWithinCapacity(createInput),
      repository.saveWithinCapacity(createInput),
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: 'clash', clashCount: 1 }])
    expect(fake.getCount()).toBe(1)
    expect(fake.statements.some((statement) => statement.includes('pg_advisory_xact_lock'))).toBe(true)
  })

  it('routes the legacy create method through the advisory-locked capacity operation', async () => {
    const fake = transactionalSql()
    const repository = createAppointmentsRepository(fake.sql)
    await repository.create({
      clinicId: 'clinic-1', patientId: 'patient-1', providerId: 'provider-1',
      startTime: '2026-09-07T09:00:00', endTime: '2026-09-07T09:30:00',
    })

    expect(fake.statements.some((statement) => statement.includes('pg_advisory_xact_lock'))).toBe(true)
  })

  it('locks and excludes the current appointment when rescheduling', async () => {
    const fake = transactionalSql()
    const repository = createAppointmentsRepository(fake.sql)
    const result = await repository.saveWithinCapacity({
      mode: 'reschedule', clinicId: 'clinic-1', appointmentId: 'appt-current',
      startTime: '2026-09-07T10:00:00', endTime: '2026-09-07T10:30:00', update: { status: 'confirmed' },
    })

    expect(result.ok).toBe(true)
    expect(fake.statements.some((statement) => statement.includes('FOR UPDATE'))).toBe(true)
    expect(fake.statements.some((statement) => statement.includes('id <>'))).toBe(true)
  })

  it('rejects a reschedule that overlaps another appointment without updating', async () => {
    const fake = transactionalSql({ externalClashes: 1 })
    const repository = createAppointmentsRepository(fake.sql)
    const result = await repository.saveWithinCapacity({
      mode: 'reschedule', clinicId: 'clinic-1', appointmentId: 'appt-current',
      startTime: '2026-09-07T10:00:00', endTime: '2026-09-07T10:30:00', update: {},
    })

    expect(result).toEqual({ ok: false, reason: 'clash', clashCount: 1 })
    expect(fake.statements.some((statement) => statement.startsWith('UPDATE appointments'))).toBe(false)
  })
})
