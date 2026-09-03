import type { Workflow } from '@docmee/db'
import { runWorkflowWithOutcome, type WorkflowContext, type WorkflowRunOutcome } from './workflow-engine.js'

/**
 * Deterministic dry-run: it exercises graph routing but never invokes a
 * provider, persists a record, or queues a future job.  The returned trace is
 * safe to show in the workflow editor as a preview rather than live evidence.
 */
export async function simulateWorkflow(
  workflow: Pick<Workflow, 'nodes' | 'edges'>,
  context: WorkflowContext = {},
): Promise<WorkflowRunOutcome> {
  return runWorkflowWithOutcome(workflow, { ...context }, {
    sendMessage: () => undefined,
    sendTemplate: () => undefined,
    notifySecretary: () => undefined,
    addTag: () => undefined,
    aiDraft: () => undefined,
    requestApproval: () => undefined,
    scheduleResume: () => undefined,
    classifyIntentConfidence: () => 'high',
    waitForReply: () => true,
    sendInteractiveMenu: () => true,
    sendSlotMenu: () => true,
    aiAgent: () => 'error',
  })
}
