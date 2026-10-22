import { createLayaAdapter, type LayaAssessment, type LayaCandidate, type LayaInput } from './adapter.js'

export interface LayaWorkflowScope {
  clinicId: string
  workflowId: string
  publishedRevision: string
  nodeId: string
  /** Eligible outgoing edge IDs, resolved by the server, not a client request or model. */
  branches: LayaCandidate[]
}
export interface LayaWorkflowInput extends Pick<LayaInput, 'clinicId' | 'text' | 'language' | 'priority'> {
  workflowId: string
  publishedRevision: string
  nodeId: string
}
export interface LayaWorkflowDependencies {
  /** Authenticated repository boundary. Return null for an unpublished or inaccessible scope. */
  readScope: (clinicId: string, workflowId: string, nodeId: string) => Promise<LayaWorkflowScope | null>
  scopeTimeoutMs?: number
}
const bounded = (value: unknown, max: number): value is string => typeof value === 'string'
  && value.trim().length > 0 && value.length <= max

/** Classification only. The engine must still validate the chosen edge and all action guards. */
export async function assessWorkflowBranch(
  adapter: ReturnType<typeof createLayaAdapter>, input: LayaWorkflowInput,
  dependencies: LayaWorkflowDependencies,
): Promise<LayaAssessment> {
  const fallback = (): LayaAssessment => ({ outcome: 'fallback', reason: 'invalid_scope', mode: 'disabled', apply: false })
  if (!input || typeof input !== 'object') return fallback()
  if (input.priority !== undefined) return { outcome: 'fallback', reason: 'deterministic_route', mode: 'disabled', apply: false }
  if (![input.clinicId, input.workflowId, input.publishedRevision, input.nodeId].every(value => bounded(value, 128))) return fallback()
  // Snapshot before yielding; caller mutation cannot change which clinic is read after inference.
  const expected = { clinicId: input.clinicId, workflowId: input.workflowId,
    publishedRevision: input.publishedRevision, nodeId: input.nodeId, text: input.text, language: input.language }
  const configuredTimeout = dependencies.scopeTimeoutMs ?? 750
  if (!Number.isFinite(configuredTimeout)) return fallback()
  const timeout = Math.max(10, Math.min(5000, configuredTimeout))
  async function read(): Promise<LayaWorkflowScope | null> {
    try {
      const value = await adapter.runDependency(
        () => dependencies.readScope(expected.clinicId, expected.workflowId, expected.nodeId), timeout)
      if (!value || value.clinicId !== expected.clinicId || value.workflowId !== expected.workflowId
        || value.publishedRevision !== expected.publishedRevision || value.nodeId !== expected.nodeId
        || !Array.isArray(value.branches) || value.branches.length < 1 || value.branches.length > 7
        || value.branches.some(branch => !branch || !bounded(branch.id, 128) || !bounded(branch.label, 1200))
        || new Set(value.branches.map(branch => branch.id)).size !== value.branches.length) return null
      // Project known fields and detach repository-owned mutable objects.
      return { clinicId: value.clinicId, workflowId: value.workflowId, publishedRevision: value.publishedRevision,
        nodeId: value.nodeId, branches: value.branches.map(({ id, label }) => ({ id, label })) }
    } catch { return null }
  }
  const before = await read()
  if (!before) return fallback()
  const result = await adapter.assess({ clinicId: expected.clinicId, text: expected.text, language: expected.language,
    task: 'workflow_branch', candidates: before.branches,
    workflow: { selectedId: before.workflowId, publishedRevision: before.publishedRevision,
      candidatesWorkflowId: before.workflowId } })
  if (result.outcome !== 'suggestion') return result
  const after = await read()
  if (!after || JSON.stringify(before) !== JSON.stringify(after)) return { ...fallback(), mode: result.mode }
  return result
}
