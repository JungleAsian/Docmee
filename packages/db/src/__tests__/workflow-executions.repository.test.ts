import { describe, expect, it } from 'vitest'
import { createWorkflowExecutionsRepository } from '../repositories/workflow-executions.repository.js'
import type { Sql } from '../client.js'

function fakeSql(rows: Record<string, unknown>[]) {
  const calls: { query: string; values: unknown[] }[] = []
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join(' '), values })
    return Promise.resolve(rows)
  }) as unknown as Sql
  ;(sql as unknown as { json: (value: unknown) => unknown }).json = (value) => value
  return { sql, calls }
}

describe('workflow execution ledger', () => {
  it('claims one workflow run for a source event and permits only failed-run recovery', async () => {
    const { sql, calls } = fakeSql([{ id: 'run-1' }])
    await createWorkflowExecutionsRepository(sql).claimRun({
      clinicId: 'clinic-1', workflowId: 'workflow-1', sourceEventId: 'wamid.1', queueJobId: 'workflow-run-1',
    })
    expect(calls[0]?.query).toContain('ON CONFLICT (clinic_id, workflow_id, source_event_id) DO UPDATE')
    expect(calls[0]?.query).toContain("WHERE workflow_runs.status = 'failed'")
    expect(calls[0]?.values).toEqual(['clinic-1', 'workflow-1', 'wamid.1', 'workflow-run-1'])
  })

  it('claims each deterministic node effect once and records provider identifiers on success', async () => {
    const { sql, calls } = fakeSql([{ id: 'effect-1' }])
    const repo = createWorkflowExecutionsRepository(sql)
    await repo.claimEffect({
      workflowRunId: 'run-1', nodeId: 'send', nodeType: 'action.send_message', executionKey: 'wf/wamid.1/send',
    })
    await repo.succeedEffect('effect-1', 'wamid.outbound')
    expect(calls[0]?.query).toContain('ON CONFLICT (execution_key) DO NOTHING')
    expect(calls[1]?.query).toContain("status = 'succeeded'")
    expect(calls[1]?.values).toEqual(['wamid.outbound', 'effect-1'])
  })

  it('preserves an uncertain state rather than replaying a potentially delivered provider action', async () => {
    const { sql, calls } = fakeSql([])
    await createWorkflowExecutionsRepository(sql).markEffectUncertain('effect-1', 'connection dropped after provider call')
    expect(calls[0]?.query).toContain("status = 'uncertain'")
    expect(calls[0]?.values).toEqual(['connection dropped after provider call', 'effect-1'])
  })
})
