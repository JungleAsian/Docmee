import type { LegacyWorkflowStatus, WorkflowStatus } from '../types/database.js'

export type WorkflowLifecycleAction = 'validate' | 'mark_ready' | 'publish' | 'archive' | 'restore'

const transitions: Record<WorkflowStatus, Partial<Record<WorkflowLifecycleAction, WorkflowStatus>>> = {
  draft: { validate: 'validated', archive: 'archived' },
  validated: { mark_ready: 'ready', archive: 'archived' },
  ready: { publish: 'published', archive: 'archived' },
  published: { archive: 'archived' },
  superseded: { archive: 'archived' },
  archived: { restore: 'draft' },
}

export function normalizeWorkflowStatus(status: LegacyWorkflowStatus): WorkflowStatus {
  return status === 'active' ? 'published' : status
}

export function workflowLifecycleTransition(
  status: LegacyWorkflowStatus,
  action: WorkflowLifecycleAction,
): WorkflowStatus | null {
  return transitions[normalizeWorkflowStatus(status)][action] ?? null
}

export function canTransitionWorkflowLifecycle(status: LegacyWorkflowStatus, action: WorkflowLifecycleAction): boolean {
  return workflowLifecycleTransition(status, action) !== null
}
