import { describe, expect, it } from 'vitest'
import { validateWorkflowDefinition } from '../workflows/workflow-validator.js'
import type { WorkflowEdge, WorkflowNode } from '@docmee/db'

const node = (id: string, kind: WorkflowNode['kind'], type: string, config: Record<string, unknown> = {}): WorkflowNode => ({ id, kind, type, config, x: 0, y: 0 })
const edge = (id: string, source: string, target: string, sourceHandle?: string): WorkflowEdge => ({ id, source, target, ...(sourceHandle ? { sourceHandle } : {}) })

describe('validateWorkflowDefinition', () => {
  it('accepts a reachable, typed workflow with one trigger', () => {
    expect(validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('message', 'action', 'action.send_message', { text: 'Hello' }),
      node('end', 'action', 'action.end'),
    ], [edge('one', 'trigger', 'message'), edge('two', 'message', 'end')], { requireTrigger: true })).toEqual([])
  })

  it('rejects unsupported, dangling, cyclic, and unreachable graphs', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('bad', 'logic', 'action.send_message'),
      node('orphan', 'action', 'action.end'),
    ], [edge('one', 'trigger', 'bad'), edge('two', 'bad', 'trigger'), edge('three', 'bad', 'missing')], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/should be kind "action"/)
    expect(errors.join('\n')).toMatch(/unknown target/)
    expect(errors.join('\n')).toMatch(/Cycle detected/)
    expect(errors.join('\n')).toMatch(/unreachable/)
  })

  it('allows an empty draft but not an active empty workflow', () => {
    expect(validateWorkflowDefinition([], [])).toEqual([])
    expect(validateWorkflowDefinition([], [], { requireTrigger: true }).join('\n')).toMatch(/active workflow requires exactly one trigger/)
  })

  it('rejects trigger types that have no worker producer', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.no_show'),
    ], [], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/type "trigger.no_show" \(unsupported node type\)/)
  })

  it('rejects ambiguous branches and pause nodes that cannot resume', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('condition', 'logic', 'logic.condition'),
      node('delay', 'logic', 'logic.delay'),
      node('end', 'action', 'action.end'),
    ], [
      edge('one', 'trigger', 'condition'),
      edge('two', 'condition', 'delay', 'true'),
      edge('three', 'condition', 'end', 'true'),
    ], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/ambiguous true branch/)
    expect(errors.join('\n')).toMatch(/requires true and false successors/)
    expect(errors.join('\n')).toMatch(/must have exactly one successor/)
    expect(errors.join('\n')).toMatch(/requires a positive amount/)
  })

  const menuOptions = (opts: Array<{ optionId: string; title: string }>) => JSON.stringify(opts)

  it('accepts a valid interactive_menu with an edge per option', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('menu', 'action', 'action.interactive_menu', {
        variant: 'button',
        options: menuOptions([{ optionId: 'a', title: 'A' }, { optionId: 'b', title: 'B' }]),
      }),
      node('ea', 'action', 'action.end'),
      node('eb', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'menu'),
      edge('ma', 'menu', 'ea', 'a'),
      edge('mb', 'menu', 'eb', 'b'),
    ], { requireTrigger: true })
    expect(errors).toEqual([])
  })

  it('rejects an interactive_menu with no options, an unwired option, and a bad handle', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('empty', 'action', 'action.interactive_menu', { options: '[]' }),
      node('menu', 'action', 'action.interactive_menu', {
        variant: 'button',
        options: menuOptions([{ optionId: 'a', title: 'A' }, { optionId: 'b', title: 'B' }]),
      }),
      node('end', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'empty'),
      edge('em', 'empty', 'menu'),
      edge('ma', 'menu', 'end', 'a'),
      edge('mbad', 'menu', 'end', 'nonexistent'),
    ], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/requires at least one option/)
    expect(errors.join('\n')).toMatch(/option "b" isn't connected to anything/)
    expect(errors.join('\n')).toMatch(/unknown handle "nonexistent"/)
  })

  it('enforces the option-count limit per variant', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('menu', 'action', 'action.interactive_menu', {
        variant: 'button',
        options: menuOptions([
          { optionId: 'a', title: 'A' }, { optionId: 'b', title: 'B' },
          { optionId: 'c', title: 'C' }, { optionId: 'd', title: 'D' },
        ]),
      }),
      node('end', 'action', 'action.end'),
    ], [edge('t', 'trigger', 'menu'), edge('m', 'menu', 'end', 'a')], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/more than WhatsApp allows for the "button" style \(max 3\)/)
  })

  it('defaults an unset variant to "list", not "button" (regression — UI shows list selected on a fresh node)', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('menu', 'action', 'action.interactive_menu', {
        // no `variant` key at all — matches a freshly-created node's config
        options: menuOptions([
          { optionId: 'a', title: 'A' }, { optionId: 'b', title: 'B' },
          { optionId: 'c', title: 'C' }, { optionId: 'd', title: 'D' },
        ]),
      }),
      node('end', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'menu'),
      edge('ma', 'menu', 'end', 'a'), edge('mb', 'menu', 'end', 'b'),
      edge('mc', 'menu', 'end', 'c'), edge('md', 'menu', 'end', 'd'),
    ], { requireTrigger: true })
    expect(errors).toEqual([])
  })

  it('enforces WhatsApp\'s title-length cap per variant — 20 for buttons, 24 for lists (regression)', () => {
    // Production incident: confirm_menu's "Back to previous menu" (21 chars)
    // passed this check under a uniform 24-char limit, but WhatsApp rejects
    // any reply BUTTON title over 20 chars outright (#131009 "Parameter
    // value is not valid") — the send path's catch then silently fell back
    // to plain, non-interactive text with no way for the patient to reply.
    const withTitle = (title: string, variant: 'button' | 'list') =>
      validateWorkflowDefinition([
        node('trigger', 'trigger', 'trigger.message_keyword'),
        node('menu', 'action', 'action.interactive_menu', { variant, options: menuOptions([{ optionId: 'a', title }]) }),
        node('end', 'action', 'action.end'),
      ], [edge('t', 'trigger', 'menu'), edge('m', 'menu', 'end', 'a')], { requireTrigger: true })

    expect(withTitle('Back to previous menu', 'button').join('\n')).toMatch(/title exceeds 20 chars/)
    expect(withTitle('Back to previous menu', 'list')).toEqual([]) // 22 chars, within the 24-char list cap
    expect(withTitle('123456789012345678901', 'button').join('\n')).toMatch(/title exceeds 20 chars/) // 21 chars
    expect(withTitle('1234567890123456789012345', 'list').join('\n')).toMatch(/title exceeds 24 chars/) // 25 chars
  })

  it('allows a conversational loop through a pausing menu but rejects a synchronous cycle', () => {
    // Legit: menu → send → back to menu (menu pauses, so this is cross-turn safe).
    const looped = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('menu', 'action', 'action.interactive_menu', {
        options: menuOptions([{ optionId: 'again', title: 'Again' }]),
      }),
      node('info', 'action', 'action.send_message', { text: 'Here you go' }),
    ], [
      edge('t', 'trigger', 'menu'),
      edge('mi', 'menu', 'info', 'again'),
      edge('im', 'info', 'menu'), // loops back to the pausing menu — allowed
    ], { requireTrigger: true })
    expect(looped.filter((e) => e.includes('Cycle detected'))).toEqual([])

    // Illegal: two send_message nodes looping with no pause between them.
    const spun = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('a', 'action', 'action.send_message', { text: 'a' }),
      node('b', 'action', 'action.send_message', { text: 'b' }),
    ], [edge('t', 'trigger', 'a'), edge('ab', 'a', 'b'), edge('ba', 'b', 'a')], { requireTrigger: true })
    expect(spun.join('\n')).toMatch(/Cycle detected/)
  })

  it('allows a menu self-loop on reserved handles (re-show / restart)', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('menu', 'action', 'action.interactive_menu', {
        variant: 'button',
        options: menuOptions([{ optionId: 'book', title: 'Book' }]),
      }),
      node('end', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'menu'),
      edge('mb', 'menu', 'end', 'book'),
      edge('mdef', 'menu', 'menu', 'default'), // unmatched reply re-shows the menu
      edge('mre', 'menu', 'menu', 'restart'), // footer "0" restarts the menu
    ], { requireTrigger: true })
    expect(errors).toEqual([])
  })

  it('still rejects a self-loop on a synchronous node', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('spam', 'action', 'action.send_message', { text: 'loop' }),
    ], [
      edge('t', 'trigger', 'spam'),
      edge('ss', 'spam', 'spam'),
    ], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/cannot point to the same node/)
  })

  it('accepts a valid offer_slot_menu with selected and empty successors', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('slots', 'action', 'action.offer_slot_menu', { pickerMode: 'date' }),
      node('picked', 'action', 'action.end'),
      node('none', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'slots'),
      edge('s1', 'slots', 'picked', 'selected'),
      edge('s2', 'slots', 'none', 'empty'),
    ], { requireTrigger: true })
    expect(errors).toEqual([])
  })

  it('accepts offer_slot_menu restart/livechat as optional extras', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('slots', 'action', 'action.offer_slot_menu', { pickerMode: 'time' }),
      node('picked', 'action', 'action.end'),
      node('none', 'action', 'action.end'),
      node('main', 'action', 'action.end'),
      node('human', 'action', 'action.notify_secretary'),
    ], [
      edge('t', 'trigger', 'slots'),
      edge('s1', 'slots', 'picked', 'selected'),
      edge('s2', 'slots', 'none', 'empty'),
      edge('s3', 'slots', 'main', 'restart'),
      edge('s4', 'slots', 'human', 'livechat'),
      edge('hm', 'human', 'main'),
    ], { requireTrigger: true })
    expect(errors).toEqual([])
  })

  it('defaults an unset pickerMode to "date", not empty-string (regression — UI shows Date selected on a fresh node)', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('slots', 'action', 'action.offer_slot_menu', {}), // no pickerMode key at all
      node('picked', 'action', 'action.end'),
      node('none', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'slots'),
      edge('s1', 'slots', 'picked', 'selected'),
      edge('s2', 'slots', 'none', 'empty'),
    ], { requireTrigger: true })
    expect(errors).toEqual([])
  })

  it('rejects an offer_slot_menu missing selected/empty, with a bad mode and an unknown handle', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('slots', 'action', 'action.offer_slot_menu', { pickerMode: 'weekday' }),
      node('end', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'slots'),
      edge('s1', 'slots', 'end', 'maybe'),
    ], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/invalid pickerMode "weekday"/)
    expect(errors.join('\n')).toMatch(/unknown handle "maybe"/)
    expect(errors.join('\n')).toMatch(/requires a "selected" successor/)
    expect(errors.join('\n')).toMatch(/requires an "empty" successor/)
  })

  it('rejects an ambiguous offer_slot_menu branch', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('slots', 'action', 'action.offer_slot_menu', { pickerMode: 'date' }),
      node('a', 'action', 'action.end'),
      node('b', 'action', 'action.end'),
      node('none', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'slots'),
      edge('s1', 'slots', 'a', 'selected'),
      edge('s2', 'slots', 'b', 'selected'),
      edge('s3', 'slots', 'none', 'empty'),
    ], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/ambiguous "selected" branch/)
  })

  const aiAgentScenarios = (scenarios: Array<{ id: string; description: string; action: string; targetWorkflowId?: string }>) =>
    JSON.stringify(scenarios)

  it('accepts a valid action.ai_agent with all four fixed successors and is exempt from "exactly one successor"', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('agent', 'action', 'action.ai_agent', {
        communicationStyle: 'friendly',
        scenarios: aiAgentScenarios([{ id: 'a', description: 'wants to book', action: 'reply' }]),
      }),
      node('replied', 'action', 'action.end'),
      node('handoff', 'action', 'action.end'),
      node('noMatch', 'action', 'action.end'),
      node('errorEnd', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'agent'),
      edge('r', 'agent', 'replied', 'replied'),
      edge('h', 'agent', 'handoff', 'handoff'),
      edge('n', 'agent', 'noMatch', 'no_match'),
      edge('e', 'agent', 'errorEnd', 'error'),
    ], { requireTrigger: true })
    expect(errors).toEqual([])
  })

  it('rejects an action.ai_agent missing successors, with zero scenarios, and an invalid style', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('agent', 'action', 'action.ai_agent', { communicationStyle: 'sarcastic', scenarios: '[]' }),
      node('end', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'agent'),
      edge('r', 'agent', 'end', 'replied'),
    ], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/invalid communicationStyle "sarcastic"/)
    expect(errors.join('\n')).toMatch(/requires at least one scenario/)
    expect(errors.join('\n')).toMatch(/requires a handoff successor/)
    expect(errors.join('\n')).toMatch(/requires a no_match successor/)
    expect(errors.join('\n')).toMatch(/requires a error successor/)
  })

  it('rejects a "route" scenario with no target workflow, a duplicate scenario id, and an unknown edge handle', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('agent', 'action', 'action.ai_agent', {
        scenarios: aiAgentScenarios([
          { id: 'a', description: 'route me', action: 'route' },
          { id: 'a', description: 'duplicate id', action: 'reply' },
        ]),
      }),
      node('replied', 'action', 'action.end'),
      node('handoff', 'action', 'action.end'),
      node('noMatch', 'action', 'action.end'),
      node('errorEnd', 'action', 'action.end'),
      node('weird', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'agent'),
      edge('r', 'agent', 'replied', 'replied'),
      edge('h', 'agent', 'handoff', 'handoff'),
      edge('n', 'agent', 'noMatch', 'no_match'),
      edge('e', 'agent', 'errorEnd', 'error'),
      edge('w', 'agent', 'weird', 'not_a_real_handle'),
    ], { requireTrigger: true })
    expect(errors.join('\n')).toMatch(/scenario "a" is set to "route" but has no target workflow/)
    expect(errors.join('\n')).toMatch(/sharing the id "a" \(duplicate scenario id\)/)
    expect(errors.join('\n')).toMatch(/unknown handle "not_a_real_handle"/)
  })

  it('accepts a "route" scenario that does supply a target workflow', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.message_keyword'),
      node('agent', 'action', 'action.ai_agent', {
        scenarios: aiAgentScenarios([{ id: 'a', description: 'route me', action: 'route', targetWorkflowId: 'wf-2' }]),
      }),
      node('replied', 'action', 'action.end'),
      node('handoff', 'action', 'action.end'),
      node('noMatch', 'action', 'action.end'),
      node('errorEnd', 'action', 'action.end'),
    ], [
      edge('t', 'trigger', 'agent'),
      edge('r', 'agent', 'replied', 'replied'),
      edge('h', 'agent', 'handoff', 'handoff'),
      edge('n', 'agent', 'noMatch', 'no_match'),
      edge('e', 'agent', 'errorEnd', 'error'),
    ], { requireTrigger: true })
    expect(errors).toEqual([])
  })
})
