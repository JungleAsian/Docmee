import { describe, expect, it } from 'vitest'
import { removeSerializedFlowEdges } from './flowEdgeChanges'
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
        { optionId: 'two', goToNext: '' },
      ],
    })
    expect(result[0]?.onFailNext).toBeUndefined()
  })
})
