import { describe, expect, it } from 'vitest'
import { canTransitionWorkflowLifecycle, normalizeWorkflowStatus, workflowLifecycleTransition } from '../workflows/workflow-lifecycle.js'

describe('workflow lifecycle', () => {
  it('allows the deliberate draft-to-publish path only', () => {
    expect(workflowLifecycleTransition('draft', 'validate')).toBe('validated')
    expect(workflowLifecycleTransition('validated', 'mark_ready')).toBe('ready')
    expect(workflowLifecycleTransition('ready', 'publish')).toBe('published')
    expect(canTransitionWorkflowLifecycle('draft', 'publish')).toBe(false)
    expect(workflowLifecycleTransition('published', 'mark_ready')).toBeNull()
  })

  it('normalizes old active records and permits archive/restore without reactivating them', () => {
    expect(normalizeWorkflowStatus('active')).toBe('published')
    expect(workflowLifecycleTransition('active', 'archive')).toBe('archived')
    expect(workflowLifecycleTransition('archived', 'restore')).toBe('draft')
  })
})
