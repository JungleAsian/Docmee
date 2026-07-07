import { describe, it, expect } from 'vitest'
import { createConversationsRepository } from '../repositories/conversations.repository.js'
import type { Sql } from '../client.js'

// A tagged-template stand-in for postgres.js that records the query text + bind
// values so we can assert the patient-name fan-in joins the patients table, is
// scoped to the clinic, and returns the rows verbatim — without a live database.
function fakeSql(rows: unknown[], capture: { query?: string; values?: unknown[] }): Sql {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    capture.query = strings.join(' ')
    capture.values = values
    return Promise.resolve(rows)
  }) as unknown as Sql
  return fn
}

describe('conversations.repository — listPatientNamesByClinic', () => {
  it('joins patients, scopes to the clinic, and returns the (conversationId, patientName) rows', async () => {
    const rows = [
      { conversationId: 'conv-1', patientName: 'María Rodríguez' },
      { conversationId: 'conv-2', patientName: 'Jorge Luna' },
    ]
    const capture: { query?: string; values?: unknown[] } = {}
    const repo = createConversationsRepository(fakeSql(rows, capture))

    const result = await repo.listPatientNamesByClinic('clinic-1')

    // Returns the joined rows verbatim for the route to fan in per conversation.
    expect(result).toEqual(rows)
    // The query joins patients and only surfaces named patients (the row falls back
    // to the channel handle otherwise), scoped to the requested clinic.
    expect(capture.query).toContain('JOIN patients')
    expect(capture.query).toContain('full_name')
    expect(capture.values).toContain('clinic-1')
  })
})
