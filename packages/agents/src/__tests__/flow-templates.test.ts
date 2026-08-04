import { describe, it, expect } from 'vitest'
import { FLOW_TEMPLATES, findFlowTemplate } from '../botbase/flow-templates.js'
import { startFlow, advanceFlow, type FlowDef } from '../botbase/flow-engine.js'

const TERMINALS = new Set(['book', 'handoff', 'end'])

function asDef(t: (typeof FLOW_TEMPLATES)[number]): FlowDef {
  return { id: t.key, startStepId: t.startStepId, steps: t.steps }
}

describe('flow-templates', () => {
  it('ships the required templates', () => {
    expect(FLOW_TEMPLATES.map((t) => t.key).sort()).toEqual(
      ['nephrology_booking', 'price', 'reschedule', 'review', 'schedule', 'surgery'],
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

  it('schedule template hands the trigger straight to the canonical booking flow', () => {
    const def = asDef(findFlowTemplate('schedule')!)
    const start = startFlow(def)
    expect(start.awaitingInput).toBe(false)
    expect(start.action).toBe('book')
    expect(start.messages.join(' ')).toMatch(/profesional.*motivo.*fecha.*hora/i)
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

  it('nephrology booking template collects intake then hands scheduling to the booking worker', () => {
    const def = asDef(findFlowTemplate('nephrology_booking')!)
    const greeting = startFlow(def)
    expect(greeting.awaitingInput).toBe(true)
    expect(greeting.messages[0]).toMatch(/Nefrologia Integral/)

    const name = advanceFlow(def, { flowId: 'nephrology_booking', stepId: greeting.nextStepId!, variables: {} }, 'quiero agendar')!
    expect(name.nextStepId).toBe('ask_patient_name')

    const reason = advanceFlow(def, { flowId: 'nephrology_booking', stepId: name.nextStepId!, variables: {} }, 'Ana Perez')!
    expect(reason.variables.patient_name).toBe('Ana Perez')

    const service = advanceFlow(def, { flowId: 'nephrology_booking', stepId: reason.nextStepId!, variables: reason.variables }, 'control renal')!
    expect(service.variables.reason).toBe('control renal')
    expect(service.nextStepId).toBe('service_selection')

    const slot = advanceFlow(def, { flowId: 'nephrology_booking', stepId: service.nextStepId!, variables: service.variables }, 'nefrologia')!
    expect(slot.variables.service).toBe('nefrologia')
    expect(slot.nextStepId).toBe('availability_request')

    const booked = advanceFlow(def, { flowId: 'nephrology_booking', stepId: slot.nextStepId!, variables: slot.variables }, 'manana a las 12')!
    expect(booked.variables.preferred_slot).toBe('manana a las 12')
    expect(booked.action).toBe('book')
  })

  it('nephrology booking template clarifies once before human handoff', () => {
    const def = asDef(findFlowTemplate('nephrology_booking')!)
    const greeting = startFlow(def)
    const clarify = advanceFlow(def, { flowId: 'nephrology_booking', stepId: greeting.nextStepId!, variables: {} }, 'no se')!
    expect(clarify.nextStepId).toBe('clarify_choice')
    const handoff = advanceFlow(def, { flowId: 'nephrology_booking', stepId: clarify.nextStepId!, variables: clarify.variables }, 'todavia no se')!
    expect(handoff.action).toBe('handoff')
  })
})
