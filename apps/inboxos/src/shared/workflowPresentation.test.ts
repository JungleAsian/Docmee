import { describe, expect, it } from 'vitest'
import { filterWorkflows, workflowNameGuidance } from './workflowPresentation'
import type { Workflow } from './types'

const workflow = (id: string, name: string, status: Workflow['status']): Workflow => ({
  id,
  clinicId: 'clinic-1',
  name,
  status,
  nodes: [],
  edges: [],
  documentVersion: 1,
  createdAt: '2026-10-02T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
})

describe('workflow presentation helpers', () => {
  const workflows = [
    workflow('1', 'Appointment booking', 'published'),
    workflow('2', 'Appointment reminder', 'draft'),
    workflow('3', 'Old intake', 'archived'),
  ]

  it('hides archived workflows by default and searches names case-insensitively', () => {
    expect(filterWorkflows(workflows, '', 'active').map((item) => item.id)).toEqual(['1', '2'])
    expect(filterWorkflows(workflows, 'REMINDER', 'active').map((item) => item.id)).toEqual(['2'])
  })

  it('supports exact status and all-status views', () => {
    expect(filterWorkflows(workflows, '', 'archived').map((item) => item.id)).toEqual(['3'])
    expect(filterWorkflows(workflows, '', 'all')).toHaveLength(3)
  })

  it('offers non-blocking naming guidance', () => {
    expect(workflowNameGuidance('', 'en')).toContain('purpose')
    expect(workflowNameGuidance('Appointment booking', 'en')).toBeNull()
    expect(workflowNameGuidance('Workflow', 'en')).toContain('specific')
  })
})
