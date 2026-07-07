import { describe, it, expect } from 'vitest'
import { FLOW_TEMPLATES, findFlowTemplate } from '../botbase/flow-templates.js'
import { startFlow, advanceFlow, type FlowDef } from '../botbase/flow-engine.js'

const TERMINALS = new Set(['book', 'handoff', 'end'])

function asDef(t: (typeof FLOW_TEMPLATES)[number]): FlowDef {
  return { id: t.key, startStepId: t.startStepId, steps: t.steps }
}

describe('flow-templates', () => {
  it('ships the five required templates', () => {
    expect(FLOW_TEMPLATES.map((t) => t.key).sort()).toEqual(
      ['price', 'reschedule', 'review', 'schedule', 'surgery'],
    )
  })

  it('findFlowTemplate resolves a known key and rejects an unknown one', () => {
    expect(findFlowTemplate('schedule')?.key).toBe('schedule')
    expect(findFlowTemplate('nope')).toBeUndefined()
  })

  it('every template is structurally valid', () => {
    for (const t of FLOW_TEMPLATES) {
      expect(t.triggerKeywords.length).toBeGreaterThan(0)
      expect(t.steps.length).toBeGreaterThan(0)
      const ids = new Set(t.steps.map((s) => s.id))
      // start step exists
      expect(ids.has(t.startStepId)).toBe(true)
      // every transition target is a known step id or a terminal token
      for (const step of t.steps) {
        const targets = [
          ...(step.branches ?? []).map((b) => b.next),
          ...(step.next != null ? [step.next] : []),
        ]
        for (const target of targets) {
          expect(ids.has(target) || TERMINALS.has(target)).toBe(true)
        }
      }
    }
  })

  it('schedule template collects a reason then books', () => {
    const def = asDef(findFlowTemplate('schedule')!)
    const start = startFlow(def)
    expect(start.awaitingInput).toBe(true)
    const r = advanceFlow(def, { flowId: 'schedule', stepId: start.nextStepId!, variables: {} }, 'control anual')!
    expect(r.variables.reason).toBe('control anual')
    expect(r.action).toBe('book')
  })

  it('review template hands off an unhappy patient and ends a happy one', () => {
    const def = asDef(findFlowTemplate('review')!)
    const start = startFlow(def)
    const unhappy = advanceFlow(def, { flowId: 'review', stepId: start.nextStepId!, variables: {} }, 'mala')!
    expect(unhappy.action).toBe('handoff')
    const happy = advanceFlow(def, { flowId: 'review', stepId: start.nextStepId!, variables: {} }, 'excelente')!
    expect(happy.action).toBeNull()
  })

  it('surgery template routes a yes to handoff', () => {
    const def = asDef(findFlowTemplate('surgery')!)
    const start = startFlow(def)
    const r = advanceFlow(def, { flowId: 'surgery', stepId: start.nextStepId!, variables: {} }, 'sí')!
    expect(r.action).toBe('handoff')
  })
})
