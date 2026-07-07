// Rev1 #28 (Gap #34): Custom flow EXECUTION ENGINE.
//
// The original custom-flows feature was a single-turn matcher: a trigger keyword
// fired a fixed list of canned messages plus one terminal action. This engine
// upgrades that to a stateful, multi-step, *conditional* flow that progresses
// turn-by-turn — the bot can ask a question, branch on the patient's reply,
// collect answers into variables, and only then book / hand off / end.
//
// Like the rest of botbase it is PURE: no DB, no LLM, no I/O. The worker loads a
// flow definition, keeps the per-conversation cursor (FlowState) in the
// conversation metadata, and calls startFlow() on the trigger turn and
// advanceFlow() on every later turn. Both return a FlowRunResult the worker
// just has to emit (send messages, persist/clear the cursor, fire the action).
import type { Language } from './language-detector.js'

export type CustomFlowAction = 'book' | 'handoff' | 'end'

/** How a branch tests the patient's reply to a waiting step. */
export type FlowBranchOp = 'contains' | 'equals' | 'yes' | 'no' | 'any'

/** A conditional transition out of a waiting step. */
export interface FlowBranch {
  op: FlowBranchOp
  /** Keywords for `contains` / `equals` (ignored for yes/no/any). */
  keywords?: string[]
  /** Target step id, or a terminal token: 'book' | 'handoff' | 'end'. */
  next: string
}

/** One node of a flow. */
export interface FlowStep {
  id: string
  /** Messages sent when this step is entered (support {{variable}} interpolation). */
  messages: string[]
  /**
   * When present and non-empty, the step WAITS for the patient's reply and routes
   * it through these branches. When absent/empty the step auto-advances to `next`.
   */
  branches?: FlowBranch[]
  /** Store the patient's reply to this (waiting) step under this variable name. */
  collect?: string | null
  /** Default transition when no branch matches, or the only transition for a
   *  non-waiting step. A terminal token or step id; null/absent ends the flow. */
  next?: string | null
  /** Terminal action when this non-waiting step ends the flow. */
  action?: CustomFlowAction | null
}

/** The executable shape of a flow (worker maps the DB row to this). */
export interface FlowDef {
  id: string
  startStepId?: string | null
  steps: FlowStep[]
}

/** The per-conversation cursor persisted between turns. */
export interface FlowState {
  flowId: string
  stepId: string
  variables: Record<string, string>
}

/** What the worker must emit after a start/advance. */
export interface FlowRunResult {
  /** Messages to send, in order, already interpolated. */
  messages: string[]
  /** Variables captured so far (persist alongside the cursor). */
  variables: Record<string, string>
  /** Step id to resume at, or null when the flow finished. */
  nextStepId: string | null
  /** Terminal action to perform, if any. */
  action: CustomFlowAction | null
  /** True when the flow is paused waiting for the patient's reply at nextStepId. */
  awaitingInput: boolean
}

const TERMINALS = new Set<string>(['book', 'handoff', 'end'])
// Loop guard: a misconfigured flow that cycles can never run more than this many
// steps in a single turn before we bail out gracefully.
const MAX_STEPS = 50

const AFFIRMATIVE = new Set([
  'si', 'sii', 'sip', 'claro', 'ok', 'okay', 'vale', 'dale', 'correcto', 'afirmativo',
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay',
])
const NEGATIVE = new Set([
  'no', 'nop', 'nope', 'negativo', 'nunca', 'jamas',
])

/** Lowercase + drop accents so "sí" matches "si". */
function deaccent(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

function tokenize(text: string): string[] {
  return deaccent(text).split(/[^a-z0-9]+/i).filter(Boolean)
}

/** Whole-word / contiguous-phrase containment (mirrors custom-flows matcher). */
function phraseInTokens(tokens: string[], keyword: string): boolean {
  const norm = deaccent(keyword).trim()
  if (!norm) return false
  const parts = norm.split(/\s+/)
  if (parts.length === 1) return tokens.includes(parts[0]!)
  return ` ${tokens.join(' ')} `.includes(` ${parts.join(' ')} `)
}

function isAffirmative(tokens: string[]): boolean {
  return tokens.some((t) => AFFIRMATIVE.has(t))
}

function isNegative(tokens: string[]): boolean {
  return tokens.some((t) => NEGATIVE.has(t))
}

/** `{{name}}` → variables.name (blank when unknown). */
function interpolate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => variables[key] ?? '')
}

function findStep(flow: FlowDef, id: string): FlowStep | undefined {
  return flow.steps.find((s) => s.id === id)
}

/** Pick the first branch whose condition matches the reply, if any. */
function selectBranch(branches: FlowBranch[], message: string): FlowBranch | undefined {
  const tokens = tokenize(message)
  const normalized = deaccent(message).trim()
  for (const branch of branches) {
    switch (branch.op) {
      case 'any':
        return branch
      case 'yes':
        if (isAffirmative(tokens)) return branch
        break
      case 'no':
        if (isNegative(tokens)) return branch
        break
      case 'equals':
        if ((branch.keywords ?? []).some((kw) => deaccent(kw).trim() === normalized)) return branch
        break
      case 'contains':
      default:
        if ((branch.keywords ?? []).some((kw) => phraseInTokens(tokens, kw))) return branch
        break
    }
  }
  return undefined
}

/**
 * Enter `stepId` and auto-advance through every non-waiting step, accumulating
 * their messages, until we hit a step that waits for the patient, a terminal
 * action, the end of the flow, or a dangling/cyclic reference (bail gracefully).
 */
function runFrom(flow: FlowDef, stepId: string, variables: Record<string, string>): FlowRunResult {
  const messages: string[] = []
  const visited = new Set<string>()
  let current = stepId

  for (let i = 0; i < MAX_STEPS; i++) {
    if (TERMINALS.has(current)) {
      return {
        messages,
        variables,
        nextStepId: null,
        action: current === 'end' ? null : (current as CustomFlowAction),
        awaitingInput: false,
      }
    }

    const step = findStep(flow, current)
    // Dangling reference or a cycle → stop cleanly rather than loop/throw.
    if (!step || visited.has(step.id)) {
      return { messages, variables, nextStepId: null, action: null, awaitingInput: false }
    }
    visited.add(step.id)

    for (const m of step.messages) messages.push(interpolate(m, variables))

    // Waiting step: pause here for the patient's reply.
    if (step.branches && step.branches.length > 0) {
      return { messages, variables, nextStepId: step.id, action: null, awaitingInput: true }
    }

    // Non-waiting step: a terminal action ends the flow ('end' carries no queue
    // action, matching the `next: 'end'` token).
    if (step.action) {
      return {
        messages,
        variables,
        nextStepId: null,
        action: step.action === 'end' ? null : step.action,
        awaitingInput: false,
      }
    }
    // …otherwise follow `next`, or end when there is none.
    if (step.next == null) {
      return { messages, variables, nextStepId: null, action: null, awaitingInput: false }
    }
    current = step.next
  }

  // Loop guard exceeded: end gracefully with whatever we have.
  return { messages, variables, nextStepId: null, action: null, awaitingInput: false }
}

/** Begin a flow from its start step (trigger turn). */
export function startFlow(flow: FlowDef, variables: Record<string, string> = {}): FlowRunResult {
  const start = flow.startStepId ?? flow.steps[0]?.id
  if (!start) {
    return { messages: [], variables, nextStepId: null, action: null, awaitingInput: false }
  }
  return runFrom(flow, start, { ...variables })
}

/**
 * Resume a flow at its waiting step with the patient's reply. Returns null when
 * the cursor no longer points at a waiting step or the reply routes nowhere — the
 * caller should then clear the cursor and let normal processing handle the turn.
 */
export function advanceFlow(flow: FlowDef, state: FlowState, message: string): FlowRunResult | null {
  const step = findStep(flow, state.stepId)
  if (!step || !step.branches || step.branches.length === 0) return null

  const variables = { ...state.variables }
  if (step.collect) variables[step.collect] = message.trim()

  const branch = selectBranch(step.branches, message)
  const target = branch?.next ?? step.next ?? null
  if (target == null) return null

  return runFrom(flow, target, variables)
}

/**
 * Adapt a stored custom flow (which may be a legacy single-shot flow or a new
 * step-based flow) into an executable FlowDef. Legacy flows — no steps, just a
 * `messages` array + optional terminal `action` — become a single non-waiting
 * step, preserving the original fire-once behaviour exactly.
 */
export function toFlowDef(flow: {
  id: string
  messages: string[]
  action?: CustomFlowAction | null
  steps?: FlowStep[] | null
  startStepId?: string | null
}): FlowDef {
  if (flow.steps && flow.steps.length > 0) {
    return { id: flow.id, startStepId: flow.startStepId ?? flow.steps[0]!.id, steps: flow.steps }
  }
  return {
    id: flow.id,
    startStepId: '__start__',
    steps: [{ id: '__start__', messages: flow.messages ?? [], action: flow.action ?? null, next: null }],
  }
}

// Re-export the matcher's Language so callers have one import surface for flows.
export type { Language }
