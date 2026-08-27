import { describe, expect, it } from 'vitest'
import { removeSerializedFlowEdges, removeSerializedFlowTargets } from './flowEdgeChanges'
import type { CustomFlowStep } from './types'

describe('removeSerializedFlowEdges', () => {
  it('removes next, branch, choice, and failure edges from the canonical step model', () => {
    const steps: CustomFlowStep[] = [{
      id: 'step-one',
      messages: ['Choose'],
      type: 'single_choice',
      next: 'default-target',
      branches: [
        { op: 'yes', next: 'yes-target' },
        { op: 'no', next: 'no-target' },
      ],
      options: [
        { optionId: 'one', title: 'One', goToNext: 'choice-one' },
        { optionId: 'two', title: 'Two', goToNext: 'choice-two' },
      ],
      onFailNext: 'failure-target',
    }]

    const result = removeSerializedFlowEdges(steps, [
      'step-one-next',
      'step-one-b0',
      'step-one-opt1',
      'step-one-onfail',
    ])

    expect(result[0]).toMatchObject({
      next: null,
      branches: [{ op: 'no', next: 'no-target' }],
      options: [
        { optionId: 'one', goToNext: 'choice-one' },
      ],
    })
    expect(result[0]?.options?.every((option) => option.goToNext.length > 0)).toBe(true)
    expect(result[0]?.onFailNext).toBeUndefined()
  })

  it('removes choice options that target a deleted node instead of leaving an empty target', () => {
    const steps: CustomFlowStep[] = [{
      id: 'choice',
      messages: ['Choose'],
      type: 'single_choice',
      options: [
        { optionId: 'keep', title: 'Keep', goToNext: 'kept-target' },
        { optionId: 'remove', title: 'Remove', goToNext: 'deleted-target' },
      ],
    }]

    const result = removeSerializedFlowTargets(steps, new Set(['deleted-target']))

    expect(result[0]?.options).toEqual([
      { optionId: 'keep', title: 'Keep', goToNext: 'kept-target' },
    ])
  })

  it('normalizes a choice node when deleting its final option edge', () => {
    const steps: CustomFlowStep[] = [{
      id: 'choice',
      messages: ['Choose'],
      type: 'single_choice',
      renderMode: 'buttons',
      options: [{ optionId: 'only', title: 'Only', goToNext: 'end' }],
    }]

    const result = removeSerializedFlowEdges(steps, ['choice-opt0'])

    expect(result[0]).toEqual({ id: 'choice', messages: ['Choose'] })
  })
})
