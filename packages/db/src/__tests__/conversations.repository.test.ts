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

describe('conversations.repository — conversation-list enrichment scope', () => {
  it('limits tags, message previews, and patient names to the returned page', async () => {
    const capture: { query?: string; values?: unknown[] } = {}
    const repo = createConversationsRepository(fakeSql([], capture))
    const pageIds = ['00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002']

    await repo.listTagNamesByClinic('clinic-1', pageIds)
    expect(capture.query).toContain('l.conversation_id = ANY')
    expect(capture.values).toContain(pageIds)

    await repo.listLastMessageByClinic('clinic-1', pageIds)
    expect(capture.query).toContain('m.conversation_id = ANY')
    expect(capture.values).toContain(pageIds)

    await repo.listPatientNamesByClinic('clinic-1', pageIds)
    expect(capture.query).toContain('c.id = ANY')
    expect(capture.values).toContain(pageIds)
  })

  it('does not query enrichment tables when the conversation page is empty', async () => {
    const capture: { query?: string; values?: unknown[] } = {}
    const repo = createConversationsRepository(fakeSql([], capture))

    await expect(repo.listTagNamesByClinic('clinic-1', [])).resolves.toEqual([])
    await expect(repo.listLastMessageByClinic('clinic-1', [])).resolves.toEqual([])
    await expect(repo.listPatientNamesByClinic('clinic-1', [])).resolves.toEqual([])
    expect(capture.query).toBeUndefined()
  })
})

describe('conversations.repository — deleteClosedBefore', () => {
  it('scopes the hard delete to terminal statuses and a clinic cutoff', async () => {
    const capture: { query?: string; values?: unknown[] } = {}
    const repo = createConversationsRepository(fakeSql([{ id: 'conv-1' }], capture))

    await expect(repo.deleteClosedBefore('clinic-1', '2026-09-06T00:00:00.000Z')).resolves.toBe(1)
    expect(capture.query).toContain("status IN ('resolved', 'archived')")
    expect(capture.query).toContain('updated_at')
    expect(capture.values).toEqual(['clinic-1', '2026-09-06T00:00:00.000Z'])
  })
})

describe('conversations.repository — scheduling session compare-and-swap', () => {
  it('counts clinic scheduling sessions without retrieving patient data', async () => {
    const capture: { query?: string; values?: unknown[] } = {}
    const repo = createConversationsRepository(fakeSql([{ count: 2 }], capture))
    await expect(repo.countSchedulingSessions('clinic-1')).resolves.toBe(2)
    expect(capture.query).toContain('COUNT(*)')
    expect(capture.query).toContain('clinic_id =')
    expect(capture.query).toContain("status IN ('open', 'assigned')")
    expect(capture.query).toContain("metadata->'scheduling'->>'action'")
    expect(capture.values).toContain('clinic-1')
  })
  it('changes only scheduling metadata and matches the expected cursor within the clinic', async () => {
    const capture: { query?: string; values?: unknown[] } = {}
    const repo = createConversationsRepository(fakeSql([{ id: 'conv-1' }], capture))
    const expected = { action: 'book', state: { step: 'awaiting_time' } }
    await expect(repo.replaceSchedulingSession('clinic-1', 'conv-1', expected, null)).resolves.toBe(true)
    expect(capture.query).toContain("- 'scheduling'")
    expect(capture.query).toContain("metadata->'scheduling'")
    expect(capture.query).toContain('clinic_id =')
    expect(capture.values).toContain('clinic-1')
    expect(capture.values).toContain('conv-1')
    expect(capture.values).toContain(JSON.stringify(expected))
  })

  it('does not claim success if another turn changed the session', async () => {
    const repo = createConversationsRepository(fakeSql([], {}))
    await expect(repo.replaceSchedulingSession('clinic-1', 'conv-1', null, { action: 'book' })).resolves.toBe(false)
  })
})
