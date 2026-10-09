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

/** Read-only routing evidence; never reset a session or return patient content. */
export function workflowRuntimeFindings(input: {
  schedulingSessionCount: number
  activeRevisionId?: string | null
  recentRuns: unknown[]
}): WorkflowDiagnosticFinding[] {
  const findings: WorkflowDiagnosticFinding[] = []
  if (input.schedulingSessionCount > 0) {
    findings.push({
      code: 'scheduling_session_interception', severity: 'warning',
      title: 'Appointment sessions can intercept new workflow triggers',
      whatHappened: `${input.schedulingSessionCount} open conversation(s) in this clinic have appointment-session state. Fresh appointment replies go to scheduling before keyword triggers. This does not prove this workflow failed.`,
      howToFix: 'For an affected conversation, send exactly menu, menú, or inicio to leave scheduling and evaluate published keyword triggers. Sessions expire after 30 minutes without activity. Do not reset all conversations.',
    })
  }
  const runs = input.recentRuns.filter((run): run is Record<string, unknown> => Boolean(run) && typeof run === 'object')
  const pinned = input.activeRevisionId ? runs.filter((run) =>
    ['running', 'waiting', 'retry_scheduled'].includes(String(run['status']))
    && typeof run['workflowRevisionId'] === 'string'
    && run['workflowRevisionId'] !== input.activeRevisionId) : []
  if (pinned.length) {
    findings.push({
      code: 'pinned_workflow_revision', severity: 'warning',
      title: 'An in-progress run uses an older published revision',
      whatHappened: `${pinned.length} recent in-progress run(s) are pinned to a revision different from the currently published revision. This preserves their original graph rather than switching midway.`,
      howToFix: 'Review the specific run before cancelling or restarting it. Test a new conversation against the published revision; do not restart every patient conversation.',
    })
  }
  const seen = new Set<string>()
  for (const run of runs) {
    const trace = run['trace'] as { menuDeliveries?: unknown } | null
    if (!trace || !Array.isArray(trace.menuDeliveries)) continue
    for (const raw of trace.menuDeliveries.slice(0, 2)) {
      if (!raw || typeof raw !== 'object') continue
      const delivery = raw as Record<string, unknown>
      if (delivery['deliveryMode'] !== 'text_fallback' || typeof delivery['nodeId'] !== 'string') continue
      const nodeId = delivery['nodeId']
      if (seen.has(nodeId)) continue
      seen.add(nodeId)
      const reason = ['provider_error', 'sender_unavailable', 'target_unavailable'].includes(String(delivery['fallbackReason']))
        ? String(delivery['fallbackReason']) : 'unknown'
      findings.push({
        code: 'interactive_menu_text_fallback', severity: 'warning', nodeId,
        title: 'A menu used the numbered-text fallback',
        whatHappened: 'A recent run recorded text fallback instead of a native WhatsApp menu. This is transport evidence, not confirmation that the recipient received the message.',
        howToFix: 'Verify the WhatsApp sender and conversation target, then check provider delivery status with an authorized test recipient.',
        technicalDetails: `Fallback reason: ${reason}`,
      })
    }
  }
  return findings
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
