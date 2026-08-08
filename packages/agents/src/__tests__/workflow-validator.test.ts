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
    expect(errors.join('\n')).toMatch(/requires action/)
    expect(errors.join('\n')).toMatch(/unknown target/)
    expect(errors.join('\n')).toMatch(/Cycle detected/)
    expect(errors.join('\n')).toMatch(/unreachable/)
  })

  it('allows an empty draft but not an active empty workflow', () => {
    expect(validateWorkflowDefinition([], [])).toEqual([])
    expect(validateWorkflowDefinition([], [], { requireTrigger: true })).toContain('An active workflow requires exactly one trigger')
  })

  it('rejects trigger types that have no worker producer', () => {
    const errors = validateWorkflowDefinition([
      node('trigger', 'trigger', 'trigger.no_show'),
    ], [], { requireTrigger: true })
    expect(errors).toContain('Unsupported node type: trigger.no_show')
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
    expect(errors.join('\n')).toMatch(/option "b" has no successor/)
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
    expect(errors.join('\n')).toMatch(/too many options for variant "button" \(max 3\)/)
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
})
