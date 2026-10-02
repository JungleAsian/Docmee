export type WorkflowDiagnosticStatus = 'ready' | 'needs_attention' | 'not_ready'
export type WorkflowDiagnosticSource = 'saved_graph' | 'unsaved_graph'
export type WorkflowDiagnosticIntegrationStatus = 'ready' | 'warning' | 'failed' | 'unknown'

export interface WorkflowDiagnosticFinding {
  code: string
  severity: 'error' | 'warning'
  title: string
  where?: string
  whatHappened?: string
  howToFix?: string
  nodeId?: string
  edgeId?: string
  technicalDetails?: string
}

export interface WorkflowDiagnosticSimulation {
  name: string
  required: boolean
  status: 'completed' | 'waiting' | 'paused' | 'failed' | 'skipped'
  result?: unknown
  reason?: string
}

export interface WorkflowDiagnosticIntegration {
  key: string
  label: string
  required: boolean
  status: WorkflowDiagnosticIntegrationStatus
  checkedAt: string
  detail?: string
}

export interface WorkflowDiagnosticInput {
  source: WorkflowDiagnosticSource
  startedAt: string
  completedAt: string
  workflowChecks: WorkflowDiagnosticFinding[]
  simulations: WorkflowDiagnosticSimulation[]
  integrations: WorkflowDiagnosticIntegration[]
  recentRuns: unknown[]
}

export interface WorkflowDiagnosticReport extends WorkflowDiagnosticInput {
  status: WorkflowDiagnosticStatus
}

export function buildWorkflowDiagnosticReport(input: WorkflowDiagnosticInput): WorkflowDiagnosticReport {
  const blocking = input.workflowChecks.some((finding) => finding.severity === 'error')
    || input.simulations.some((simulation) => simulation.required && simulation.status === 'failed')
    || input.integrations.some((integration) => integration.required && integration.status === 'failed')

  const attention = input.workflowChecks.some((finding) => finding.severity === 'warning')
    || input.simulations.some((simulation) => !simulation.required && simulation.status === 'failed')
    || input.integrations.some((integration) => integration.status === 'warning' || integration.status === 'unknown')

  return {
    ...input,
    status: blocking ? 'not_ready' : attention ? 'needs_attention' : 'ready',
  }
}
