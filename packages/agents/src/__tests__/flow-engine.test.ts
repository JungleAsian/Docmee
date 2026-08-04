import { describe, it, expect } from 'vitest'
import {
  startFlow,
  advanceFlow,
  advanceFlowTo,
  inspectFlowReply,
  toFlowDef,
  type FlowDef,
  type FlowState,
} from '../botbase/flow-engine.js'

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

  it('does not let an early `any` branch mask a later deterministic match', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 'q',
      steps: [
        {
          id: 'q',
          messages: ['?'],
          branches: [
            { op: 'any', next: 'other' },
            { op: 'contains', keywords: ['especialista'], next: 'specialist' },
          ],
        },
        { id: 'other', messages: ['Otro'], next: 'end' },
        { id: 'specialist', messages: ['Especialista'], next: 'end' },
      ],
    }
    const r = advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, 'un especialista')!
    expect(r.messages).toEqual(['Especialista'])
  })

  it('exposes bounded semantic candidates and rejects an invented target', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 'q',
      steps: [
        {
          id: 'q',
          messages: ['?'],
          branches: [
            { op: 'yes', next: 'book' },
            { op: 'no', next: 'end' },
            { op: 'any', next: 'handoff' },
          ],
        },
      ],
    }
    const state: FlowState = { flowId: 'f', stepId: 'q', variables: {} }
    expect(inspectFlowReply(flow, state, 'maybe')).toEqual({
      matchedNext: null,
      fallbackNext: 'handoff',
      candidates: [
        { index: 0, op: 'yes', keywords: [], next: 'book' },
        { index: 1, op: 'no', keywords: [], next: 'end' },
      ],
    })
    expect(advanceFlowTo(flow, state, 'maybe', 'delete_everything')).toBeNull()
    expect(advanceFlowTo(flow, state, 'please do it', 'book')?.action).toBe('book')
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

describe('flow-engine — branch ops (starts_with / regex)', () => {
  const flow: FlowDef = {
    id: 'f',
    startStepId: 'q',
    steps: [
      {
        id: 'q',
        messages: ['?'],
        branches: [
          { op: 'starts_with', keywords: ['hola'], next: 'greet' },
          { op: 'regex', pattern: '^\\d{4}-\\d{2}-\\d{2}$', next: 'date' },
          { op: 'any', next: 'other' },
        ],
      },
      { id: 'greet', messages: ['Hola!'], next: 'end' },
      { id: 'date', messages: ['Fecha recibida.'], next: 'end' },
      { id: 'other', messages: ['?'], next: 'handoff' },
    ],
  }

  it('matches starts_with accent/case-insensitively', () => {
    const r = advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, 'HOLA buenas tardes')!
    expect(r.messages).toEqual(['Hola!'])
  })

  it('matches regex against the raw message', () => {
    const r = advanceFlow(flow, { flowId: 'f', stepId: 'q', variables: {} }, '2026-08-03')!
    expect(r.messages).toEqual(['Fecha recibida.'])
  })

  it('treats an invalid regex pattern as a non-match rather than throwing', () => {
    const bad: FlowDef = {
      id: 'f',
      startStepId: 'q',
      steps: [
        { id: 'q', messages: ['?'], branches: [{ op: 'regex', pattern: '(', next: 'x' }, { op: 'any', next: 'other' }] },
        { id: 'other', messages: ['fallback'], next: 'end' },
      ],
    }
    const r = advanceFlow(bad, { flowId: 'f', stepId: 'q', variables: {} }, 'anything')!
    expect(r.messages).toEqual(['fallback'])
  })
})

describe('flow-engine — single_choice', () => {
  const choiceFlow: FlowDef = {
    id: 'cf1',
    startStepId: 'menu',
    steps: [
      {
        id: 'menu',
        type: 'single_choice',
        messages: ['¿Cómo podemos ayudarte?'],
        header: 'Menú',
        footer: 'Clínica Demo',
        renderMode: 'buttons',
        collect: 'reason',
        storeAs: 'optionId',
        options: [
          { optionId: 'book_appt', title: 'Agendar cita', goToNext: 'book' },
          { optionId: 'reschedule', title: 'Reprogramar', goToNext: 'reschedule_step' },
          { optionId: 'talk_staff', title: 'Hablar con el equipo', goToNext: 'handoff', saveValue: 'staff' },
        ],
        branches: [{ op: 'contains', keywords: ['precio', 'costo'], next: 'pricing' }],
        maxRetries: 1,
        onFailNext: 'handoff',
        retryMessage: 'No entendí, por favor elige una opción.',
      },
      { id: 'reschedule_step', messages: ['Vamos a reprogramar.'], next: 'end' },
      { id: 'pricing', messages: ['Nuestros precios...'], next: 'end' },
    ],
  }

  it('pauses at the menu with a rendered plain-text prompt and a structured interactivePrompt', () => {
    const r = startFlow(choiceFlow)
    expect(r.awaitingInput).toBe(true)
    expect(r.nextStepId).toBe('menu')
    expect(r.messages).toEqual([
      'Menú',
      '¿Cómo podemos ayudarte?',
      '1. Agendar cita\n2. Reprogramar\n3. Hablar con el equipo',
      'Clínica Demo',
    ])
    expect(r.interactivePrompt).toEqual({
      kind: 'buttons',
      body: '¿Cómo podemos ayudarte?',
      header: 'Menú',
      footer: 'Clínica Demo',
      buttonLabel: 'Select',
      options: [
        { id: 'book_appt', title: 'Agendar cita' },
        { id: 'reschedule', title: 'Reprogramar' },
        { id: 'talk_staff', title: 'Hablar con el equipo' },
      ],
    })
  })

  it('routes a tapped option by its stable id, bypassing keywords, and stores per storeAs', () => {
    const r = advanceFlow(choiceFlow, { flowId: 'cf1', stepId: 'menu', variables: {} }, 'Agendar cita', 'book_appt')!
    expect(r.action).toBe('book')
    expect(r.variables.reason).toBe('book_appt') // storeAs: 'optionId'
  })

  it('stores saveValue when storeAs is saveValue', () => {
    const flow: FlowDef = {
      id: 'f',
      startStepId: 'menu',
      steps: [
        {
          id: 'menu',
          type: 'single_choice',
          messages: ['?'],
          options: [{ optionId: 'a', title: 'A', goToNext: 'end', saveValue: 'chose_a' }],
          collect: 'choice',
          storeAs: 'saveValue',
        },
      ],
    }
    const r = advanceFlow(flow, { flowId: 'f', stepId: 'menu', variables: {} }, 'A', 'a')!
    expect(r.variables.choice).toBe('chose_a')
  })

  it('falls back to keyword conditions when no interactiveReplyId is given (typed reply)', () => {
    const r = advanceFlow(choiceFlow, { flowId: 'cf1', stepId: 'menu', variables: {} }, 'cuál es el costo')!
    expect(r.messages).toEqual(['Nuestros precios...'])
  })

  it('falls back to keyword conditions when interactiveReplyId is stale/unknown', () => {
    const r = advanceFlow(choiceFlow, { flowId: 'cf1', stepId: 'menu', variables: {} }, 'precio por favor', 'no_such_option')!
    expect(r.messages).toEqual(['Nuestros precios...'])
  })

  it('re-prompts (retry) on an unmatched reply, up to maxRetries, then routes to onFailNext', () => {
    const first = advanceFlow(choiceFlow, { flowId: 'cf1', stepId: 'menu', variables: {} }, 'no entiendo')!
    expect(first.awaitingInput).toBe(true)
    expect(first.nextStepId).toBe('menu')
    expect(first.retryCount).toBe(1)
    expect(first.messages).toEqual(['No entendí, por favor elige una opción.'])

    const second = advanceFlow(choiceFlow, { flowId: 'cf1', stepId: 'menu', variables: {}, retryCount: first.retryCount }, 'sigo sin entender')!
    expect(second.awaitingInput).toBe(false)
    expect(second.action).toBe('handoff')
  })

  it('legacy (non-single_choice) steps keep exact current no-match behavior', () => {
    expect(advanceFlow(bookingFlow, { flowId: 'f1', stepId: 'ask', variables: {} }, 'x')).not.toBeNull()
    const noBranchStep: FlowDef = { id: 'f', startStepId: 'a', steps: [{ id: 'a', messages: ['x'] }] }
    expect(advanceFlow(noBranchStep, { flowId: 'f', stepId: 'a', variables: {} }, 'hola')).toBeNull()
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
