import type { Workflow, WorkflowStatus } from './types'

export type WorkflowStatusFilter = 'active' | WorkflowStatus | 'all'

export function filterWorkflows(workflows: Workflow[], query: string, status: WorkflowStatusFilter): Workflow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return workflows.filter((workflow) => {
    const statusMatches = status === 'all' || (status === 'active' ? workflow.status !== 'archived' : workflow.status === status)
    const queryMatches = !normalizedQuery || workflow.name.toLocaleLowerCase().includes(normalizedQuery)
    return statusMatches && queryMatches
  })
}

export function workflowNameGuidance(name: string, language: 'es' | 'en'): string | null {
  const normalized = name.trim()
  if (!normalized) {
    return language === 'es'
      ? 'Usa un nombre que describa el propósito del flujo.'
      : 'Use a name that describes the workflow purpose.'
  }
  if (/^(workflow|automation|flow|flujo|automatizaci[oó]n)$/i.test(normalized)) {
    return language === 'es'
      ? 'Haz el nombre más específico, por ejemplo “Recordatorio de cita”.'
      : 'Make the name more specific, for example “Appointment reminder”.'
  }
  return null
}
