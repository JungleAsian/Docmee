import { describe, expect, it, vi } from 'vitest'
import type { WorkflowEdge, WorkflowNode } from '@docmee/db'
import { simulateWorkflow, type WorkflowSimulationHooks } from '../workflows/workflow-simulator.js'
import { decideLayaMenuReply } from '../workflows/laya-menu.js'

const node = (id: string, kind: WorkflowNode['kind'], type: string, config: Record<string, unknown> = {}): WorkflowNode => ({ id, kind, type, config, x: 0, y: 0 })
const edge = (source: string, target: string, sourceHandle?: string): WorkflowEdge => ({ id: `${source}-${target}-${sourceHandle ?? 'next'}`, source, target, ...(sourceHandle ? { sourceHandle } : {}) })

// main menu: book -> booked (end) ; manage -> manage menu: cancel -> cancel_booking, keep -> kept (end)
const workflow = {
  nodes: [
    node('start', 'trigger', 'trigger.message_keyword'),
    node('main', 'action', 'action.interactive_menu', { options: [{ optionId: 'book', title: 'Book an appointment' }, { optionId: 'manage', title: 'My appointments' }] }),
    node('booked', 'action', 'action.end'),
    node('manage', 'action', 'action.interactive_menu', { options: [{ optionId: 'cancel', title: 'Yes, cancel it' }, { optionId: 'keep', title: 'No, keep it' }] }),
    node('cancel', 'action', 'action.cancel_booking'),
    node('cancelled', 'action', 'action.end'),
    node('kept', 'action', 'action.end'),
    node('help', 'action', 'action.end'),
  ],
  edges: [
    edge('start', 'main'), edge('main', 'booked', 'book'), edge('main', 'manage', 'manage'),
    edge('manage', 'cancel', 'cancel'), edge('manage', 'kept', 'keep'), edge('cancel', 'cancelled'),
    // Reserved routes every real menu has: "didn't understand" and 0 = main menu.
    edge('main', 'help', 'default'), edge('manage', 'help', 'default'), edge('manage', 'main', 'restart'),
  ],
}

function hooks(picks: Record<string, string | null>) {
  let next = 0
  const layaChoose = vi.fn<NonNullable<WorkflowSimulationHooks['layaChoose']>>(async ({ text }) => {
    const choiceId = picks[text] ?? null
    return { choiceId, observedChoiceId: choiceId, score: choiceId ? 0.98 : 0.3, reason: choiceId ? 'qualified' : 'uncertain', ref: `ref-${++next}` }
  })
  const layaLabel = vi.fn<NonNullable<WorkflowSimulationHooks['layaLabel']>>(async () => true)
  return { layaChoose, layaLabel }
}

const messages = (result: { effects: { kind: string; summary: string }[] }) => result.effects.filter((effect) => effect.kind === 'message').map((effect) => effect.summary)
const notes = (result: { effects: { kind: string; summary: string }[] }) => result.effects.filter((effect) => effect.kind === 'laya').map((effect) => effect.summary)

describe('simulateWorkflow with LAYA', () => {
  it('routes the opening message and says what it understood', async () => {
    const h = hooks({ 'quiero una cita': 'book' })
    const result = await simulateWorkflow(workflow, { context: { message: 'quiero una cita' } }, h)
    expect(h.layaChoose).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'main', source: 'menu_trigger' }))
    expect(result.status).toBe('completed')
    expect(result.trace.at(-1)?.nodeId).toBe('booked')
    expect(messages(result)).toContain('Entendí: “Book an appointment”. ¿No es correcto? Responda 0 para volver al menú principal.')
    expect(notes(result)[0]).toContain('LAYA picked “Book an appointment” (score 0.98) and routed')
    expect(result.laya).toEqual({ calls: 1, examplesSaved: 1, labelsSaved: 0 })
  })

  it('holds a booking change for YES/NO, shows the menu again on NO, and labels the correcting tap', async () => {
    const h = hooks({ 'necesito cancelar': 'cancel' })
    const atMain = await simulateWorkflow(workflow, {}, h)
    const atManage = await simulateWorkflow(workflow, { replay: atMain.replay, reply: { optionId: 'manage' } }, h)
    expect(atManage.waitingFor).toEqual({ kind: 'menu', nodeId: 'manage' })

    const held = await simulateWorkflow(workflow, { replay: atManage.replay, reply: { text: 'necesito cancelar' } }, h)
    expect(held.waitingFor).toEqual({ kind: 'menu', nodeId: 'manage' })
    expect(messages(held).at(-1)).toBe('Usted escribió: “necesito cancelar”. Entendí: “Yes, cancel it”. Responda SÍ para continuar o NO para elegir otra opción.')
    expect(held.trace.some((step) => step.nodeId === 'cancel')).toBe(false)

    const resent = await simulateWorkflow(workflow, { replay: held.replay, reply: { text: 'no' } }, h)
    expect(resent.waitingFor).toEqual({ kind: 'menu', nodeId: 'manage' })
    expect(resent.trace.some((step) => step.nodeId === 'cancel')).toBe(false)
    expect(messages(resent).at(-1)).toBe('Interactive menu mocked')

    const kept = await simulateWorkflow(workflow, { replay: resent.replay, reply: { optionId: 'keep' } }, h)
    expect(kept.trace.at(-1)?.nodeId).toBe('kept')
    expect(kept.context.booking_status).toBeUndefined()
    expect(h.layaLabel).toHaveBeenCalledWith({ ref: 'ref-1', nodeId: 'manage', optionId: 'keep', how: 'next_tap' })
    expect(notes(kept).at(-1)).toBe('Corrected: training example labelled “No, keep it” (LAYA picked “Yes, cancel it”).')
  })

  it('continues only on a clear YES and labels the example as confirmed', async () => {
    const h = hooks({ 'cancelala por favor': 'cancel' })
    const atMain = await simulateWorkflow(workflow, {}, h)
    const atManage = await simulateWorkflow(workflow, { replay: atMain.replay, reply: { optionId: 'manage' } }, h)
    const held = await simulateWorkflow(workflow, { replay: atManage.replay, reply: { text: 'cancelala por favor' } }, h)
    const done = await simulateWorkflow(workflow, { replay: held.replay, reply: { text: 'sí' } }, h)
    expect(done.status).toBe('completed')
    expect(done.context.booking_status).toBe('cancelled')
    expect(h.layaLabel).toHaveBeenCalledWith({ ref: 'ref-1', nodeId: 'manage', optionId: 'cancel', how: 'readback_yes' })
    expect(done.laya?.labelsSaved).toBe(1)
  })

  it('lets 0 at the read-back go back to the main menu', async () => {
    const h = hooks({ 'borrala': 'cancel' })
    const atMain = await simulateWorkflow(workflow, {}, h)
    const atManage = await simulateWorkflow(workflow, { replay: atMain.replay, reply: { optionId: 'manage' } }, h)
    const held = await simulateWorkflow(workflow, { replay: atManage.replay, reply: { text: 'borrala' } }, h)
    const result = await simulateWorkflow(workflow, { replay: held.replay, reply: { text: '0' } }, h)
    expect(result.trace.some((step) => step.nodeId === 'cancel')).toBe(false)
    expect(result.waitingFor).toEqual({ kind: 'menu', nodeId: 'main' })
    expect(h.layaLabel).not.toHaveBeenCalled()
  })

  it('reports a watch-only pick without routing when LAYA may not act', async () => {
    const h = {
      layaChoose: vi.fn(async () => ({ choiceId: null, observedChoiceId: 'manage', score: 0.62, reason: 'uncertain', ref: 'ref-x' })),
      layaLabel: vi.fn(async () => true),
    }
    const atMain = await simulateWorkflow(workflow, {}, h)
    const result = await simulateWorkflow(workflow, { replay: atMain.replay, reply: { text: 'tengo una cita' } }, h)
    expect(notes(result).at(-1)).toBe('LAYA would pick “My appointments” (score 0.62) but may not act (uncertain). Saved as a training example.')
    // Not allowed to act: the menu's own default route runs, exactly as on WhatsApp.
    expect(result.trace.at(-1)?.nodeId).toBe('help')
    expect(result.context.layaSimulationExample).toEqual({ nodeId: 'main', ref: 'ref-x', layaChoiceId: 'manage' })
  })

  it('stays offline and unchanged without hooks', async () => {
    const atMain = await simulateWorkflow(workflow)
    const result = await simulateWorkflow(workflow, { replay: atMain.replay, reply: { text: 'quiero una cita' } })
    expect(result.laya).toBeUndefined()
    expect(result.effects.some((effect) => effect.kind === 'laya')).toBe(false)
  })
})

describe('decideLayaMenuReply', () => {
  const options = [{ optionId: 'cancel', title: 'Yes, cancel it' }, { optionId: 'keep', title: 'No, keep it' }]
  const pending = { nodeId: 'manage', optionId: 'cancel', title: 'Yes, cancel it' }
  const choose = vi.fn(async () => null)
  it.each([
    ['sí', undefined, 'cancel'],
    ['no, otra hora', undefined, '__resend__'],
    ['what?', undefined, '__resend__'],
    ['', 'keep', 'keep'],
    ['0', undefined, 'restart'],
    ['1', undefined, 'livechat'],
  ])('answers a pending read-back: %s', async (text, replyId, expected) => {
    const decision = await decideLayaMenuReply({ nodeId: 'manage', options, text, replyId, pending, choose })
    expect(decision.handle).toBe(expected)
    expect(choose).not.toHaveBeenCalled()
  })
})
