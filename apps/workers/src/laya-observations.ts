import {
  assessAdministrativeIntent,
  assessWorkflowBranch,
  isObservableTypedReply,
  layaLanguageOf,
  menuBranchCandidates,
  redactPatientText,
  type LayaAssessment,
  type LayaCandidate,
} from '@docmee/agents'
import { createLayaObservationsRepository } from '@docmee/db'
import { getLayaAdapter, getLayaDb, runLayaBackground } from './laya.js'

/**
 * LAYA watch-only wiring for workflow menus and the AI agent step.
 *
 * 1. Capture: typed text at a menu (or the message that started the run) is stored
 *    redacted, then labelled by the option the patient taps next on that same menu.
 * 2. Shadow: LAYA scores the same text in the background; its pick is stored, never used.
 * 3. Live: only when the clinic's mode is `live` AND a reviewed qualification is installed
 *    does `liveMenuChoice` return an option; every other case returns null.
 */

export interface MenuScope {
  clinicId: string
  conversationId?: string
  workflowId: string
  workflowRevisionId?: string
  nodeId: string
}

type MenuOption = { optionId: string; title: string; description?: string }

const observations = () => createLayaObservationsRepository(getLayaDb())

/** Watch-only hooks must never break or delay a patient reply, whatever goes wrong. */
function safely(work: () => void): void {
  try { work() } catch { /* deliberately silent: measurement is optional */ }
}

function choiceOf(result: LayaAssessment): string | null {
  return result.choiceId ?? result.observedChoiceId ?? null
}

async function scoreBranch(scope: MenuScope, text: string, candidates: LayaCandidate[]): Promise<{ result: LayaAssessment; latencyMs: number } | null> {
  const adapter = getLayaAdapter()
  if (!adapter || !scope.workflowRevisionId) return null
  const revision = scope.workflowRevisionId
  const started = performance.now()
  const result = await assessWorkflowBranch(adapter, {
    clinicId: scope.clinicId, workflowId: scope.workflowId, publishedRevision: revision,
    nodeId: scope.nodeId, text, language: layaLanguageOf(text),
  }, {
    // The worker already loaded this pinned, published revision from the database.
    readScope: async (clinicId, workflowId, nodeId) => clinicId === scope.clinicId && workflowId === scope.workflowId && nodeId === scope.nodeId
      ? { clinicId, workflowId, publishedRevision: revision, nodeId, branches: candidates }
      : null,
  })
  return { result, latencyMs: performance.now() - started }
}

async function record(
  scope: MenuScope, source: 'menu_trigger' | 'menu_unmatched', redacted: string, candidates: LayaCandidate[] | null,
  scored?: { result: LayaAssessment; latencyMs: number } | null,
): Promise<void> {
  const repo = observations()
  if (!(await repo.isCaptureEnabled(scope.clinicId))) return
  const id = await repo.create({
    clinicId: scope.clinicId, conversationId: scope.conversationId ?? null, workflowId: scope.workflowId,
    workflowRevisionId: scope.workflowRevisionId ?? null, nodeId: scope.nodeId, task: 'workflow_branch', source,
    language: layaLanguageOf(redacted), redactedText: redacted, candidateIds: (candidates ?? []).map(candidate => candidate.id),
  })
  if (!id || !candidates) return
  const outcome = scored === undefined ? await scoreBranch(scope, redacted, candidates) : scored
  if (!outcome) return
  await repo.attachAssessment(scope.clinicId, id, {
    mode: outcome.result.mode, reason: outcome.result.reason, choiceId: choiceOf(outcome.result),
    rawScore: outcome.result.rawScore ?? null, latencyMs: outcome.latencyMs,
  })
}

/** Background only: never awaited by the patient reply path. */
export function observeMenuText(scope: MenuScope, text: string, source: 'menu_trigger' | 'menu_unmatched', options: MenuOption[]): void {
  safely(() => {
    if (!isObservableTypedReply(text)) return
    const redacted = redactPatientText(text)
    if (!redacted) return
    runLayaBackground(() => record(scope, source, redacted, menuBranchCandidates(options)))
  })
}

/** A real tap (or a clear YES to LAYA's read-back) labels the open typed observations for this
 * same menu. Background only. */
export function labelMenuTap(scope: MenuScope, choiceId: string, labelSource: 'next_tap' | 'readback_yes' = 'next_tap'): void {
  safely(() => {
    if (!scope.conversationId || !choiceId) return
    const conversationId = scope.conversationId
    runLayaBackground(() => observations().labelOpenForMenu({
      clinicId: scope.clinicId, conversationId, workflowId: scope.workflowId, nodeId: scope.nodeId, choiceId,
      ...(labelSource === 'readback_yes' ? { labelSource } : {}),
    }))
  })
}

/**
 * For an unmatched typed reply: returns the option LAYA is allowed to route to, or null.
 * Only `live` mode is awaited (adds up to the adapter deadline); shadow/advisory never block.
 */
export async function liveMenuChoice(scope: MenuScope, text: string, options: MenuOption[],
  source: 'menu_trigger' | 'menu_unmatched' = 'menu_unmatched'): Promise<string | null> {
  try { return await liveMenuChoiceUnsafe(scope, text, options, source) } catch { return null }
}

async function liveMenuChoiceUnsafe(scope: MenuScope, text: string, options: MenuOption[],
  source: 'menu_trigger' | 'menu_unmatched'): Promise<string | null> {
  if (!isObservableTypedReply(text)) return null
  const adapter = getLayaAdapter()
  const redacted = redactPatientText(text)
  const candidates = menuBranchCandidates(options)
  let mode: Awaited<ReturnType<NonNullable<typeof adapter>['taskMode']>> = null
  if (adapter && candidates && scope.workflowRevisionId) {
    try { mode = await adapter.taskMode(scope.clinicId, 'workflow_branch') } catch { mode = null }
  }
  if (mode !== 'live' || !candidates || !redacted) {
    observeMenuText(scope, text, source, options)
    return null
  }
  let scored: { result: LayaAssessment; latencyMs: number } | null = null
  try { scored = await scoreBranch(scope, redacted, candidates) } catch { scored = null }
  runLayaBackground(() => record(scope, source, redacted, candidates, scored))
  const result = scored?.result
  if (!result || !result.apply || result.outcome !== 'suggestion' || !result.choiceId) return null
  return candidates.some(candidate => candidate.id === result.choiceId) ? result.choiceId : null
}

/** AI agent step: LAYA's administrative intent next to the agent's own scenario. Background only. */
export function observeAiAgentText(scope: MenuScope, text: string, agentScenarioId: string): void {
  safely(() => observeAiAgentTextUnsafe(scope, text, agentScenarioId))
}

function observeAiAgentTextUnsafe(scope: MenuScope, text: string, agentScenarioId: string): void {
  if (!isObservableTypedReply(text)) return
  const redacted = redactPatientText(text)
  if (!redacted) return
  runLayaBackground(async () => {
    const repo = observations()
    if (!(await repo.isCaptureEnabled(scope.clinicId))) return
    const id = await repo.create({
      clinicId: scope.clinicId, conversationId: scope.conversationId ?? null, workflowId: scope.workflowId,
      workflowRevisionId: scope.workflowRevisionId ?? null, nodeId: scope.nodeId, task: 'administrative_intent',
      source: 'ai_agent', language: layaLanguageOf(redacted), redactedText: redacted, candidateIds: [],
    })
    if (!id) return
    if (agentScenarioId) await repo.labelById(scope.clinicId, id, agentScenarioId, 'ai_scenario')
    const adapter = getLayaAdapter()
    if (!adapter) return
    const started = performance.now()
    const result = await assessAdministrativeIntent(adapter, { clinicId: scope.clinicId, text: redacted, language: layaLanguageOf(redacted) })
    await repo.attachAssessment(scope.clinicId, id, {
      mode: result.mode, reason: result.reason, choiceId: choiceOf(result),
      rawScore: result.rawScore ?? null, latencyMs: performance.now() - started,
    })
  })
}
