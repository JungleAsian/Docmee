import type { CustomFlowStep } from './types'

/** Apply React Flow edge removals to the workflow JSON that the runner executes. */
export function removeSerializedFlowEdges(
  steps: CustomFlowStep[],
  removedEdgeIds: readonly string[],
): CustomFlowStep[] {
  const removals = new Set(removedEdgeIds)
  return steps.map((step) => {
    const nextRemoved = removals.has(`${step.id}-next`)
    const failureRemoved = removals.has(`${step.id}-onfail`)
    const branches = step.branches?.filter((_branch, index) => !removals.has(`${step.id}-b${index}`))
    const options = step.options?.map((option, index) =>
      removals.has(`${step.id}-opt${index}`) ? { ...option, goToNext: '' } : option,
    )
    return {
      ...step,
      ...(nextRemoved ? { next: null } : {}),
      ...(branches ? { branches } : {}),
      ...(options ? { options } : {}),
      ...(failureRemoved ? { onFailNext: undefined } : {}),
    }
  })
}
