import { describe, expect, it } from 'vitest'
import type { Sql } from '../client.js'
import { createLayaControlsRepository } from '../repositories/laya-controls.repository.js'

const clinicId = '84a7f77f-2f4f-45aa-b057-124f94ae41c4'
function database(rows: unknown[] = []) {
  const calls: { query: string; values: unknown[] }[] = []
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join(' '), values })
    return Promise.resolve(rows)
  }) as unknown as Sql
  return { sql, calls }
}

describe('LAYA durable controls repository', () => {
  it('reads only the named global and selected-clinic flags using bound scope', async () => {
    const rows = [{ name: 'docmee_laya', clinicId: null, metadata: {} }]
    const db = database(rows)
    expect(await createLayaControlsRepository(db.sql).readForClinic(clinicId)).toEqual(rows)
    expect(db.calls).toHaveLength(1)
    expect(db.calls[0]!.query).toMatch(/name = 'docmee_laya'/)
    expect(db.calls[0]!.query).toMatch(/clinic_id IS NULL OR clinic_id =/)
    expect(db.calls[0]!.query).toMatch(/SELECT name, clinic_id, enabled, rollout_percentage, metadata/)
    expect(db.calls[0]!.values).toEqual([clinicId])
    expect(db.calls[0]!.query).not.toMatch(/INSERT|UPDATE|DELETE|SELECT \*/)
  })

  it('bounds results without hiding ambiguous duplicate global flags', async () => {
    const rows = [{ clinicId: null }, { clinicId: null }]
    const db = database(rows)
    expect(await createLayaControlsRepository(db.sql).readForClinic(clinicId)).toEqual(rows)
    expect(db.calls[0]!.query).toMatch(/LIMIT 1001/)
    expect(db.calls[0]!.query).not.toMatch(/DISTINCT|GROUP BY/)
  })

  it.each(['', ' ', 'other-clinic', "' OR true --"])(
    'does not query with invalid UUID scope %j', async invalid => {
      const db = database()
      expect(await createLayaControlsRepository(db.sql).readForClinic(invalid)).toEqual([])
      expect(db.calls).toHaveLength(0)
    },
  )

  it('propagates store failure to the fail-closed shared reader', async () => {
    const sql = (() => Promise.reject(new Error('store unavailable'))) as unknown as Sql
    await expect(createLayaControlsRepository(sql).readForClinic(clinicId)).rejects.toThrow('store unavailable')
  })
})
