import { describe, expect, it } from 'vitest'
import type { WorkflowEdge, WorkflowNode } from '@docmee/db'
import { checkClinicSetup, type ClinicSetupFacts, type LiveWorkflow } from '../workflows/clinic-setup-check.js'

const node = (id: string, type: string, config: Record<string, unknown> = {}): WorkflowNode => ({
  id, type, kind: type.split('.')[0] as WorkflowNode['kind'], config, x: 0, y: 0,
})
const edge = (source: string, target: string): WorkflowEdge => ({ id: `${source}-${target}`, source, target })

/** A small valid live workflow: keyword trigger → message → end. */
function workflow(id: string, keywords: string, extra: Partial<LiveWorkflow> = {}): LiveWorkflow {
  return {
    id,
    name: `Flow ${id}`,
    nodes: [
      node('t', 'trigger.message_keyword', { keywords }),
      node('m', 'action.send_message', { text: 'Hola' }),
      node('e', 'action.end'),
    ],
    edges: [edge('t', 'm'), edge('m', 'e')],
    ...extra,
  }
}

const HOURS = { monday: { open: '09:00', close: '22:00', closed: false } }
const facts = (overrides: Partial<ClinicSetupFacts> = {}): ClinicSetupFacts => ({
  clinicId: 'c1',
  businessHours: HOURS,
  automationDuringBusinessHours: true,
  channelStatuses: ['active'],
  liveWorkflows: [workflow('w1', 'cita')],
  lint: { calendarConnected: true, doctorCount: 1 },
  ...overrides,
})
const codes = (f: ClinicSetupFacts) => checkClinicSetup(f).map((issue) => issue.code)

describe('checkClinicSetup', () => {
  it('finds nothing wrong with a correctly configured clinic', () => {
    expect(checkClinicSetup(facts())).toEqual([])
  })

  it('flags workflows that can never run because business hours are not set', () => {
    const issues = checkClinicSetup(facts({ businessHours: null, automationDuringBusinessHours: false }))
    expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([['workflows_never_run', 'error']])
    expect(issues[0]!.href).toBe('/studio/clinics/c1')
    expect(issues[0]!.translations.es.title).toContain('nunca')
  })

  it('warns that workflows only answer after hours when the all-day switch is off', () => {
    expect(codes(facts({ automationDuringBusinessHours: false }))).toEqual(['workflows_after_hours_only'])
  })

  it('says nothing about hours when there are no live keyword workflows', () => {
    expect(codes(facts({ liveWorkflows: [], automationDuringBusinessHours: false, businessHours: null }))).toEqual([])
  })

  it('flags a clinic with live workflows but no active messaging channel', () => {
    expect(codes(facts({ channelStatuses: ['error', 'inactive'] }))).toEqual(['no_active_channel'])
  })

  it('flags a live workflow that the runner will refuse to execute', () => {
    const broken = workflow('w1', 'cita', { edges: [edge('t', 'm')] })
    const issues = checkClinicSetup(facts({ liveWorkflows: [broken] }))
    expect(issues.map((issue) => issue.code)).toEqual(['published_workflow_broken'])
    expect(issues[0]!.workflowId).toBe('w1')
  })

  it('summarises a live workflow’s warnings', () => {
    const issues = checkClinicSetup(facts({ liveWorkflows: [workflow('w1', '')] }))
    expect(issues.map((issue) => issue.code)).toEqual(['published_workflow_warnings'])
    expect(issues[0]!.whatHappened).toContain('This workflow starts on every message')
  })

  it('flags two live workflows that start on the same messages', () => {
    const issues = checkClinicSetup(facts({ liveWorkflows: [workflow('w1', 'cita, hola'), workflow('w2', 'hola')] }))
    expect(issues.map((issue) => issue.code)).toEqual(['overlapping_triggers'])
    expect(issues[0]!.key).toBe('overlapping_triggers:w1+w2')
  })

  it('does not flag workflows with distinct keywords', () => {
    expect(codes(facts({ liveWorkflows: [workflow('w1', 'cita'), workflow('w2', 'precio')] }))).toEqual([])
  })

  it.each(['any words', 'urgent, ANY WORDS'])('warns when a catch-all overlaps a specific trigger: %s', (keywords) => {
    for (const liveWorkflows of [
      [workflow('w1', keywords), workflow('w2', 'cita')],
      [workflow('w1', 'cita'), workflow('w2', keywords)],
    ]) {
      const issues = checkClinicSetup(facts({ liveWorkflows }))
      expect(issues.map((issue) => issue.code)).toEqual(['overlapping_triggers'])
      expect(issues[0]!.whatHappened).toContain('two different replies')
    }
  })

  it('does not treat a longer literal phrase as a catch-all', () => {
    expect(codes(facts({ liveWorkflows: [workflow('w1', 'not any words'), workflow('w2', 'cita')] }))).toEqual([])
  })

  it('lists errors before warnings', () => {
    const issues = checkClinicSetup(facts({ automationDuringBusinessHours: false, channelStatuses: [] }))
    expect(issues.map((issue) => issue.severity)).toEqual(['error', 'warning'])
  })
})
