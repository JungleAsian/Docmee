import type { CustomFlowStep } from './types'

function normalizeChoiceStep(step: CustomFlowStep): CustomFlowStep {
  if (step.type !== 'single_choice' || (step.options?.length ?? 0) > 0) return step
  const normalized = { ...step }
  delete normalized.type
  delete normalized.header
  delete normalized.footer
  delete normalized.renderMode
  delete normalized.listButtonLabel
  delete normalized.options
  delete normalized.storeAs
  delete normalized.retryMessage
  delete normalized.maxRetries
  delete normalized.onFailNext
  return normalized
}

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
    const options = step.options?.filter((_option, index) => !removals.has(`${step.id}-opt${index}`))
    return normalizeChoiceStep({
      ...step,
      ...(nextRemoved ? { next: null } : {}),
      ...(branches ? { branches } : {}),
      ...(options ? { options } : {}),
      ...(failureRemoved ? { onFailNext: undefined } : {}),
    })
  })
}

/** Remove every serialized route to nodes deleted from the canvas. */
export function removeSerializedFlowTargets(
  steps: CustomFlowStep[],
  removedTargetIds: ReadonlySet<string>,
): CustomFlowStep[] {
  return steps.map((step) => normalizeChoiceStep({
    ...step,
    ...(step.next && removedTargetIds.has(step.next) ? { next: null } : {}),
    ...(step.branches ? { branches: step.branches.filter((branch) => !removedTargetIds.has(branch.next)) } : {}),
    ...(step.options ? { options: step.options.filter((option) => !removedTargetIds.has(option.goToNext)) } : {}),
    ...(step.onFailNext && removedTargetIds.has(step.onFailNext) ? { onFailNext: undefined } : {}),
  }))
}
