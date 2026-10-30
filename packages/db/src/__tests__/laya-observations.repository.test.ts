import { describe, expect, it } from 'vitest'
import { createLayaObservationsRepository } from '../repositories/laya-observations.repository.js'

const clinicId = '84a7f77f-2f4f-45aa-b057-124f94ae41c4'
const workflowId = '4632c7fa-ae3c-4f86-ab05-8c6272f254d7'
const conversationId = '11111111-2222-4333-8444-555555555555'

function recorder(result: unknown[] = []) {
  const calls: { query: string; values: unknown[] }[] = []
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?').replace(/\s+/g, ' ').trim(), values })
    return result
  }
  Object.assign(tagged, { array: (value: unknown[]) => ({ array: value }) })
  return { sql: tagged as never, calls }
}

describe('LAYA observations repository', () => {
  it('treats capture as on only for an enabled clinic row at 100% rollout', async () => {
    expect(await createLayaObservationsRepository(recorder([{ enabled: true, rolloutPercentage: 100 }]).sql).isCaptureEnabled(clinicId)).toBe(true)
    expect(await createLayaObservationsRepository(recorder([{ enabled: true, rolloutPercentage: 50 }]).sql).isCaptureEnabled(clinicId)).toBe(false)
    expect(await createLayaObservationsRepository(recorder([]).sql).isCaptureEnabled(clinicId)).toBe(false)
    const { sql, calls } = recorder([{ enabled: true, rolloutPercentage: 100 }])
    expect(await createLayaObservationsRepository(sql).isCaptureEnabled('not-a-uuid')).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('inserts bounded fields and drops invalid ids instead of failing', async () => {
    const { sql, calls } = recorder([{ id: 'abc' }])
    const id = await createLayaObservationsRepository(sql).create({
      clinicId, conversationId: 'bad', workflowId, workflowRevisionId: undefined, nodeId: 'main_menu',
      task: 'workflow_branch', source: 'menu_unmatched', language: 'es', redactedText: 'quiero cita', candidateIds: ['book', 'prices'],
    })
    expect(id).toBe('abc')
    expect(calls[0]!.query).toContain('INSERT INTO laya_observations')
    expect(calls[0]!.values).toContain(null) // invalid conversation id → null
    expect(calls[0]!.values).toContainEqual({ array: ['book', 'prices'] })
  })

  it('labels only open same-menu workflow_branch rows inside the time window', async () => {
    const { sql, calls } = recorder([{ id: 'a' }, { id: 'b' }])
    const count = await createLayaObservationsRepository(sql).labelOpenForMenu({
      clinicId, conversationId, workflowId, nodeId: 'main_menu', choiceId: 'book_appointment', windowMinutes: 999,
    })
    expect(count).toBe(2)
    const { query, values } = calls[0]!
    expect(query).toContain("task = 'workflow_branch' AND label_choice_id IS NULL")
    expect(query).toContain('ORDER BY created_at DESC LIMIT 20')
    expect(values).toContain(120) // window is clamped
    expect(values).toContain('book_appointment')
  })

  it('summarises counts without selecting patient text', async () => {
    const { sql, calls } = recorder([])
    await createLayaObservationsRepository(sql).summary(clinicId)
    expect(calls).toHaveLength(2)
    for (const call of calls) expect(call.query).not.toContain('redacted_text')
  })

  it('keeps simulator rows out of the patient summary', async () => {
    const { sql, calls } = recorder([])
    await createLayaObservationsRepository(sql).summary(clinicId)
    for (const call of calls) expect(call.query).toContain("source <> 'simulation'")
  })

  it('stores simulator rows with longer retention', async () => {
    const { sql, calls } = recorder([{ id: 'sim' }])
    await createLayaObservationsRepository(sql).create({
      clinicId, workflowId, nodeId: 'main_menu', task: 'workflow_branch', source: 'simulation', language: 'es',
      redactedText: 'quiero una cita', candidateIds: ['book'], retentionDays: 365,
    })
    expect(calls[0]!.values).toContain('simulation')
    expect(calls[0]!.values).toContain(365)
    const { sql: other, calls: otherCalls } = recorder([{ id: 'x' }])
    await createLayaObservationsRepository(other).create({
      clinicId, workflowId, nodeId: 'main_menu', task: 'workflow_branch', source: 'menu_unmatched', language: 'es',
      redactedText: 'hola', candidateIds: [], retentionDays: 9999,
    })
    expect(otherCalls[0]!.values).toContain(90) // out-of-range retention falls back to the default
  })

  it('labels only an open simulator row whose menu offered the chosen option', async () => {
    const { sql, calls } = recorder([{ id: 'sim' }])
    const ok = await createLayaObservationsRepository(sql).labelSimulationExample(clinicId, conversationId, 'keep', 'readback_yes')
    expect(ok).toBe(true)
    expect(calls[0]!.query).toContain("source = 'simulation' AND label_choice_id IS NULL")
    expect(calls[0]!.query).toContain('= ANY(candidate_ids)')
    expect(calls[0]!.values).toContain('readback_yes')
    const { sql: none } = recorder([])
    expect(await createLayaObservationsRepository(none).labelSimulationExample(clinicId, conversationId, 'keep', 'next_tap')).toBe(false)
    expect(await createLayaObservationsRepository(none).labelSimulationExample(clinicId, 'not-a-uuid', 'keep', 'next_tap')).toBe(false)
  })

  it('exports only labelled simulator rows', async () => {
    const { sql, calls } = recorder([{ id: 'a', layaRawScore: '0.9', createdAt: '2026-10-31T00:00:00Z' }])
    const rows = await createLayaObservationsRepository(sql).simulationTrainingExamples(clinicId)
    expect(calls[0]!.query).toContain("source = 'simulation' AND task = 'workflow_branch' AND label_choice_id IS NOT NULL")
    expect(rows[0]!.layaRawScore).toBe(0.9)
  })

  it('purges by expiry', async () => {
    const { sql, calls } = recorder([{ deletedCount: 4 }])
    expect(await createLayaObservationsRepository(sql).purgeExpired(new Date('2026-12-01T00:00:00Z'))).toBe(4)
    expect(calls[0]!.query).toContain('DELETE FROM laya_observations WHERE expires_at <=')
  })
})
