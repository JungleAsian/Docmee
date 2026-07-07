import { describe, it, expect } from 'vitest'
import { startFlow, advanceFlow, toFlowDef, type FlowDef, type FlowState } from '../botbase/flow-engine.js'

const bookingFlow: FlowDef = {
  id: 'f1',
  startStepId: 'ask',
  steps: [
    {
      id: 'ask',
      messages: ['¿Cuál es el motivo de tu consulta?'],
      collect: 'reason',
      branches: [{ op: 'any', next: 'confirm' }],
    },
    { id: 'confirm', messages: ['Buscaré horarios para: {{reason}}.'], next: 'book' },
  ],
}

describe('flow-engine — startFlow', () => {
  it('runs the start step and pauses at the first waiting step', () => {
    const r = startFlow(bookingFlow)
    expect(r.messages).toEqual(['¿Cuál es el motivo de tu consulta?'])
    expect(r.awaitingInput).toBe(true)
    expect(r.nextStepId).toBe('ask')
    expect(r.action).toBeNull()
  })

  it('auto-advances through non-waiting steps to a terminal action', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 's0',
      steps: [
        { id: 's0', messages: ['Hola'], next: 's1' },
        { id: 's1', messages: ['Te conecto con el calendario.'], next: 'book' },
      ],
    }
    const r = startFlow(flow)
    expect(r.messages).toEqual(['Hola', 'Te conecto con el calendario.'])
    expect(r.awaitingInput).toBe(false)
    expect(r.nextStepId).toBeNull()
    expect(r.action).toBe('book')
  })
})

describe('flow-engine — advanceFlow', () => {
  it('collects the reply into a variable and interpolates it later', () => {
    const state: FlowState = { flowId: 'f1', stepId: 'ask', variables: {} }
    const r = advanceFlow(bookingFlow, state, 'dolor de cabeza')!
    expect(r.variables.reason).toBe('dolor de cabeza')
    expect(r.messages).toEqual(['Buscaré horarios para: dolor de cabeza.'])
    expect(r.action).toBe('book')
    expect(r.awaitingInput).toBe(false)
  })

  it('routes a yes/no branch', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 'q',
      steps: [
        { id: 'q', messages: ['¿Reprogramar?'], branches: [{ op: 'yes', next: 'do' }, { op: 'no', next: 'keep' }] },
        { id: 'do', messages: ['Reprogramando.'], next: 'book' },
        { id: 'keep', messages: ['Sin cambios.'], next: 'end' },
      ],
    }
    const yes = advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, 'sí, por favor')!
    expect(yes.action).toBe('book')
    const no = advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, 'no gracias')!
    expect(no.messages).toEqual(['Sin cambios.'])
    expect(no.action).toBeNull()
    expect(no.nextStepId).toBeNull()
  })

  it('routes a contains branch (accent-insensitive) and falls back to `any`', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 'q',
      steps: [
        {
          id: 'q',
          messages: ['¿Qué servicio?'],
          branches: [
            { op: 'contains', keywords: ['especialista'], next: 'spec' },
            { op: 'any', next: 'other' },
          ],
        },
        { id: 'spec', messages: ['Costo especialista.'], next: 'end' },
        { id: 'other', messages: ['Te conecto con el equipo.'], next: 'handoff' },
      ],
    }
    const spec = advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, 'quiero un especíalista')!
    expect(spec.messages).toEqual(['Costo especialista.'])
    const other = advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, 'algo más')!
    expect(other.action).toBe('handoff')
  })

  it('returns null when the reply routes nowhere (no branch, no default next)', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 'q',
      steps: [{ id: 'q', messages: ['?'], branches: [{ op: 'yes', next: 'x' }] }],
    }
    expect(advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, 'no')).toBeNull()
  })

  it('returns null when the cursor is not a waiting step', () => {
    const flow: FlowDef = { id: 'f', startStepId: 'a', steps: [{ id: 'a', messages: ['x'], next: 'end' }] }
    expect(advanceFlow(flow, { flowId: 'f', stepId: 'a', variables: {} }, 'hola')).toBeNull()
  })

  it('uses the default `next` when no branch matches', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 'q',
      steps: [
        { id: 'q', messages: ['?'], branches: [{ op: 'yes', next: 'yes' }], next: 'fallback' },
        { id: 'yes', messages: ['Sí'], next: 'end' },
        { id: 'fallback', messages: ['No entendí, te ayudo de otra forma.'], next: 'handoff' },
      ],
    }
    const r = advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, 'mmm tal vez')!
    expect(r.messages).toEqual(['No entendí, te ayudo de otra forma.'])
    expect(r.action).toBe('handoff')
  })
})

describe('flow-engine — safety guards', () => {
  it('ends gracefully on a dangling step reference', () => {
    const flow: FlowDef = { id: 'f', startStepId: 's0', steps: [{ id: 's0', messages: ['x'], next: 'missing' }] }
    const r = startFlow(flow)
    expect(r.messages).toEqual(['x'])
    expect(r.nextStepId).toBeNull()
    expect(r.action).toBeNull()
  })

  it('breaks a cycle instead of looping forever', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 'a',
      steps: [
        { id: 'a', messages: ['a'], next: 'b' },
        { id: 'b', messages: ['b'], next: 'a' },
      ],
    }
    const r = startFlow(flow)
    // visits a then b then bails when a repeats
    expect(r.messages).toEqual(['a', 'b'])
    expect(r.nextStepId).toBeNull()
  })
})

describe('flow-engine — toFlowDef (legacy compatibility)', () => {
  it('wraps a legacy single-shot flow into one fire-once step', () => {
    const def = toFlowDef({ id: 'leg', messages: ['m1', 'm2'], action: 'end' })
    const r = startFlow(def)
    expect(r.messages).toEqual(['m1', 'm2'])
    expect(r.awaitingInput).toBe(false)
    expect(r.action).toBeNull() // 'end' has no terminal queue action
    expect(r.nextStepId).toBeNull()
  })

  it('prefers steps when present', () => {
    const def = toFlowDef({ id: 'x', messages: ['ignored'], steps: bookingFlow.steps, startStepId: 'ask' })
    expect(def.startStepId).toBe('ask')
    expect(startFlow(def).nextStepId).toBe('ask')
  })

  it('carries a legacy book/handoff action through as the terminal action', () => {
    const r = startFlow(toFlowDef({ id: 'b', messages: ['Te agendo'], action: 'book' }))
    expect(r.action).toBe('book')
  })
})
