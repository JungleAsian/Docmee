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
  it('claims one workflow run for a source event and permits only recoverable-run recovery', async () => {
    const { sql, calls } = fakeSql([{ id: 'run-1' }])
    await createWorkflowExecutionsRepository(sql).claimRun({
      clinicId: 'clinic-1', workflowId: 'workflow-1', workflowRevisionId: 'revision-1', sourceEventId: 'wamid.1', queueJobId: 'workflow-run-1',
    })
    expect(calls[0]?.query).toContain('ON CONFLICT (clinic_id, workflow_id, source_event_id) DO UPDATE')
    expect(calls[0]?.query).toContain("WHERE workflow_runs.status IN ('failed', 'retry_scheduled')")
    expect(calls[0]?.query).toContain('cancel_requested_at IS NULL')
    expect(calls[0]?.values).toEqual(['clinic-1', 'workflow-1', 'revision-1', 'wamid.1', 'workflow-run-1'])
  })

  it('persists a resume cursor before a future delay job may be queued', async () => {
    const { sql, calls } = fakeSql([{ id: 'run-1' }])
    const saved = await createWorkflowExecutionsRepository(sql).scheduleResume({
      id: 'run-1',
      from: ['running'],
      resumeAt: new Date('2026-09-03T12:00:00.000Z'),
      reason: 'delay',
      currentNodeId: 'next-node',
      trace: { trace: [{ nodeId: 'delay', status: 'paused' }] },
    })
    expect(saved).toBe(true)
    expect(calls[0]?.query).toContain("SET status = 'waiting'")
    expect(calls[0]?.query).toContain('resume_at =')
    expect(calls[0]?.query).toContain('cancel_requested_at IS NULL')
  })

  it('scopes cancellation to the workflow and clinic that own the run', async () => {
    const { sql, calls } = fakeSql([{ id: 'run-1' }])
    await createWorkflowExecutionsRepository(sql).requestCancellation({ id: 'run-1', clinicId: 'clinic-1', workflowId: 'workflow-1' })
    expect(calls[0]?.query).toContain('clinic_id =')
    expect(calls[0]?.query).toContain('workflow_id =')
    expect(calls[0]?.values).toEqual(['run-1', 'clinic-1', 'workflow-1'])
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
