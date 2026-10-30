import {
  assessWorkflowBranch,
  isObservableTypedReply,
  layaLanguageOf,
  menuBranchCandidates,
  redactPatientText,
  type LayaSimulationPick,
  type WorkflowSimulationHooks,
} from '@docmee/agents'
import { createLayaObservationsRepository } from '@docmee/db'
import { withDb } from './db.js'
import { getLayaAdapter } from './laya.js'

/** Simulator rows are typed by clinic staff, not patients; keep them a year for training. */
const SIMULATION_RETENTION_DAYS = 365

/** LAYA hooks only for a clinic with LAYA turned on for menus; other clinics simulate offline as before. */
export async function layaSimulationHooksFor(scope: { clinicId: string; workflowId: string; revisionId?: string | null }): Promise<WorkflowSimulationHooks> {
  try {
    const mode = await getLayaAdapter()?.taskMode(scope.clinicId, 'workflow_branch')
    return mode && mode !== 'disabled' ? simulationLayaHooks(scope) : {}
  } catch {
    return {}
  }
}

/**
 * Lets the Automation Center simulator use the real LAYA model with the same gate as WhatsApp
 * (clinic mode live + reviewed qualification + threshold), and saves each typed reply as a
 * training example when the clinic has LAYA capture on. Labels come only from the tester's own
 * tap or clear YES. Nothing here sends a message or changes a booking.
 */
export function simulationLayaHooks(scope: { clinicId: string; workflowId: string; revisionId?: string | null }): WorkflowSimulationHooks {
  const revision = scope.revisionId || 'simulation'
  return {
    async layaChoose({ nodeId, text, options }): Promise<LayaSimulationPick | null> {
      if (!isObservableTypedReply(text)) return { choiceId: null, reason: 'not_typed_text' }
      const redacted = redactPatientText(text)
      const candidates = menuBranchCandidates(options)
      if (!redacted) return { choiceId: null, reason: 'invalid_input' }
      if (!candidates) return { choiceId: null, reason: 'menu_not_scorable' }
      const adapter = getLayaAdapter()
      if (!adapter) return null
      let mode: Awaited<ReturnType<typeof adapter.taskMode>> = null
      try { mode = await adapter.taskMode(scope.clinicId, 'workflow_branch') } catch { mode = null }
      const language = layaLanguageOf(redacted)
      const result = await assessWorkflowBranch(adapter, {
        clinicId: scope.clinicId, workflowId: scope.workflowId, publishedRevision: revision, nodeId, text: redacted, language,
      }, {
        // The route already loaded this clinic's workflow; the menu options are its own.
        readScope: async (clinicId, workflowId, readNodeId) => clinicId === scope.clinicId && workflowId === scope.workflowId && readNodeId === nodeId
          ? { clinicId, workflowId, publishedRevision: revision, nodeId: readNodeId, branches: candidates }
          : null,
      })
      const observed = result.choiceId ?? result.observedChoiceId ?? null
      const routes = mode === 'live' && result.apply && result.outcome === 'suggestion' && !!result.choiceId
        && candidates.some(candidate => candidate.id === result.choiceId)
      let ref: string | null = null
      try {
        ref = await withDb(async sql => {
          const repo = createLayaObservationsRepository(sql)
          if (!(await repo.isCaptureEnabled(scope.clinicId))) return null
          const id = await repo.create({
            clinicId: scope.clinicId, conversationId: null, workflowId: scope.workflowId,
            workflowRevisionId: scope.revisionId ?? null, nodeId, task: 'workflow_branch', source: 'simulation',
            language, redactedText: redacted, candidateIds: candidates.map(candidate => candidate.id),
            retentionDays: SIMULATION_RETENTION_DAYS,
          })
          if (id) {
            await repo.attachAssessment(scope.clinicId, id, {
              mode: result.mode, reason: result.reason, choiceId: observed, rawScore: result.rawScore ?? null,
            })
          }
          return id
        })
      } catch { ref = null }
      return {
        choiceId: routes ? result.choiceId! : null,
        observedChoiceId: observed,
        score: typeof result.rawScore === 'number' ? result.rawScore : null,
        reason: mode !== 'live' && result.reason === 'qualified' ? `mode_${mode ?? 'unknown'}` : result.reason,
        ...(ref ? { ref } : {}),
      }
    },

    async layaLabel({ ref, optionId, how }) {
      return withDb(sql => createLayaObservationsRepository(sql).labelSimulationExample(scope.clinicId, ref, optionId, how))
    },
  }
}
