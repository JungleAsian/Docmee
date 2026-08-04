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
export type FlowBranchOp = 'contains' | 'equals' | 'yes' | 'no' | 'any' | 'starts_with' | 'regex'

/** A conditional transition out of a waiting step. */
export interface FlowBranch {
  op: FlowBranchOp
  /** Keywords for `contains` / `equals` / `starts_with` (ignored otherwise). */
  keywords?: string[]
  /** Match text for `op: 'regex'` (ignored otherwise). */
  pattern?: string
  /** Target step id, or a terminal token: 'book' | 'handoff' | 'end'. */
  next: string
}

/** Single Choice node type discriminator (Punchlist Aug 3 parity spec). */
export type FlowStepType = 'single_choice'
export type FlowRenderMode = 'buttons' | 'list'
export type FlowStoreAs = 'optionId' | 'title' | 'saveValue'

/** A tappable option on a `single_choice` step. */
export interface FlowChoiceOption {
  /** Unique within the node; sent as the WhatsApp interactive reply id. */
  optionId: string
  /** Tappable label (WhatsApp limit: 24 chars). */
  title: string
  /** Row subtitle; `renderMode: 'list'` only (WhatsApp limit: 72 chars). */
  description?: string
  /** Branch target: a stepId in this flow, or a terminal token. */
  goToNext: string
  /** Literal value written to the step's `collect` variable when chosen. */
  saveValue?: string
}

/** What the caller should render as a real WhatsApp interactive message (a
 *  richer alternative to the plain-text `messages` rendering, WhatsApp only). */
export interface FlowInteractivePrompt {
  kind: FlowRenderMode
  body: string
  header?: string
  footer?: string
  /** Tap-to-open button label; `kind: 'list'` only. */
  buttonLabel?: string
  options: Array<{ id: string; title: string; description?: string }>
}

/** One node of a flow. */
export interface FlowStep {
  id: string
  /** Messages sent when this step is entered (support {{variable}} interpolation). */
  messages: string[]
  /**
   * When present and non-empty, the step WAITS for the patient's reply and routes
   * it through these branches. When absent/empty the step auto-advances to `next`
   * (unless `type: 'single_choice'`, which always waits — see below).
   */
  branches?: FlowBranch[]
  /** Store the patient's reply to this (waiting) step under this variable name. */
  collect?: string | null
  /** Default transition when no branch matches, or the only transition for a
   *  non-waiting step. A terminal token or step id; null/absent ends the flow. */
  next?: string | null
  /** Terminal action when this non-waiting step ends the flow. */
  action?: CustomFlowAction | null
  // Single Choice — a tappable WhatsApp buttons/list menu that branches per
  // option. Absent `type` = today's legacy step; fields below are additive.
  type?: FlowStepType
  header?: string
  footer?: string
  renderMode?: FlowRenderMode
  listButtonLabel?: string
  options?: FlowChoiceOption[]
  /** What `collect` stores when an option is chosen (default 'optionId'). */
  storeAs?: FlowStoreAs
  /** Sent on an unmatched reply when `next` (the default transition) is null. */
  retryMessage?: string
  /** Unmatched-reply attempts allowed before routing to `onFailNext` (default 2). */
  maxRetries?: number
  /** Terminal/step after `maxRetries` exceeded (default 'handoff'). */
  onFailNext?: string
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
  /** Consecutive hybrid-routing clarification attempts at this waiting step. */
  clarificationCount?: number
  /** Unmatched-reply attempts so far at a `single_choice` step (default 0). */
  retryCount?: number
}

/** A configured non-catch-all edge an LLM may classify an off-script reply into. */
export interface FlowSemanticCandidate {
  index: number
  op: Exclude<FlowBranchOp, 'any'>
  keywords: string[]
  next: string
}

/** Deterministic routing evidence exposed to the worker's bounded hybrid layer. */
export interface FlowReplyRouting {
  matchedNext: string | null
  fallbackNext: string | null
  candidates: FlowSemanticCandidate[]
}

/** What the worker must emit after a start/advance. */
export interface FlowRunResult {
  /** Messages to send, in order, already interpolated. Always the plain-text
   *  rendering — used as-is for non-WhatsApp channels, and as the fallback when
   *  an `interactivePrompt` send fails. */
  messages: string[]
  /** Variables captured so far (persist alongside the cursor). */
  variables: Record<string, string>
  /** Step id to resume at, or null when the flow finished. */
  nextStepId: string | null
  /** Terminal action to perform, if any. */
  action: CustomFlowAction | null
  /** True when the flow is paused waiting for the patient's reply at nextStepId. */
  awaitingInput: boolean
  /** Present when the paused step is a `single_choice` menu: send this as a real
   *  WhatsApp interactive message instead of `messages` (WhatsApp channel only). */
  interactivePrompt?: FlowInteractivePrompt
  /** Unmatched-reply attempts so far at the paused step (persist into FlowState). */
  retryCount?: number
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

/** Pick a deterministic branch; `any` is a fallback and never masks later edges. */
function selectBranch(branches: FlowBranch[], message: string): FlowBranch | undefined {
  const tokens = tokenize(message)
  const normalized = deaccent(message).trim()
  for (const branch of branches) {
    switch (branch.op) {
      case 'any':
        break
      case 'yes':
        if (isAffirmative(tokens)) return branch
        break
      case 'no':
        if (isNegative(tokens)) return branch
        break
      case 'equals':
        if ((branch.keywords ?? []).some((kw) => deaccent(kw).trim() === normalized)) return branch
        break
      case 'starts_with':
        if ((branch.keywords ?? []).some((kw) => normalized.startsWith(deaccent(kw).trim()))) return branch
        break
      case 'regex':
        // A misconfigured pattern is a no-match, not a crash — the flow just
        // falls through to the next branch / default transition.
        if (branch.pattern) {
          try {
            if (new RegExp(branch.pattern, 'iu').test(message)) return branch
          } catch {
            // invalid pattern — treat as no match
          }
        }
        break
      case 'contains':
      default:
        if ((branch.keywords ?? []).some((kw) => phraseInTokens(tokens, kw))) return branch
        break
    }
  }
  return undefined
}

function numberedOptions(options: FlowChoiceOption[]): string {
  return options.map((o, i) => `${i + 1}. ${o.title}`).join('\n')
}

/** Render a `single_choice` step's prompt: plain-text fallback lines (used for
 *  non-WhatsApp channels, or when a real interactive send fails) plus the
 *  structured payload for a WhatsApp interactive buttons/list send. */
function buildChoicePrompt(
  step: FlowStep,
  variables: Record<string, string>,
): { messages: string[]; interactivePrompt: FlowInteractivePrompt } {
  const options = step.options ?? []
  const body = step.messages.map((m) => interpolate(m, variables)).join('\n')
  const messages: string[] = []
  if (step.header) messages.push(step.header)
  if (body) messages.push(body)
  if (options.length > 0) messages.push(numberedOptions(options))
  if (step.footer) messages.push(step.footer)

  return {
    messages,
    interactivePrompt: {
      kind: step.renderMode ?? 'buttons',
      body,
      ...(step.header ? { header: step.header } : {}),
      ...(step.footer ? { footer: step.footer } : {}),
      buttonLabel: step.listButtonLabel ?? 'Select',
      options: options.map((o) => ({
        id: o.optionId,
        title: o.title,
        ...(o.description ? { description: o.description } : {}),
      })),
    },
  }
}

/**
 * Inspect a waiting reply without advancing the flow. The worker uses this to
 * keep exact/keyword/yes-no routing deterministic and invoke its LLM classifier
 * only when those checks do not understand an off-script answer.
 */
export function inspectFlowReply(flow: FlowDef, state: FlowState, message: string): FlowReplyRouting | null {
  const step = findStep(flow, state.stepId)
  if (!step?.branches?.length) return null

  const matched = selectBranch(step.branches, message)
  const fallback = step.branches.find((branch) => branch.op === 'any')
  const candidates = step.branches.flatMap((branch, index): FlowSemanticCandidate[] =>
    branch.op === 'any'
      ? []
      : [{ index, op: branch.op, keywords: branch.keywords ?? [], next: branch.next }],
  )
  return {
    matchedNext: matched?.next ?? null,
    fallbackNext: fallback?.next ?? step.next ?? null,
    candidates,
  }
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

    // Single Choice: always waits (even with zero keyword branches) and renders
    // as a tappable menu rather than plain step.messages.
    if (step.type === 'single_choice') {
      const prompt = buildChoicePrompt(step, variables)
      return {
        messages: [...messages, ...prompt.messages],
        variables,
        nextStepId: step.id,
        action: null,
        awaitingInput: true,
        interactivePrompt: prompt.interactivePrompt,
      }
    }

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

const DEFAULT_MAX_RETRIES = 2
const DEFAULT_ON_FAIL_NEXT = 'handoff'

/**
 * Resume a flow at its waiting step with the patient's reply. Returns null when
 * the cursor no longer points at a waiting step or the reply routes nowhere — the
 * caller should then clear the cursor and let normal processing handle the turn.
 *
 * `interactiveReplyId` is the stable id of a tapped WhatsApp button/list row
 * (Single Choice). When it matches the current step's `options`, it wins
 * immediately — bypassing keyword branches — so routing never depends on the
 * patient's device locale or a retyped label.
 */
export function advanceFlow(
  flow: FlowDef,
  state: FlowState,
  message: string,
  interactiveReplyId?: string,
): FlowRunResult | null {
  const step = findStep(flow, state.stepId)
  if (!step) return null
  const isWaiting = (step.branches && step.branches.length > 0) || step.type === 'single_choice'
  if (!isWaiting) return null

  const variables = { ...state.variables }

  // Single Choice: a tapped option's stable id is deterministic ground truth —
  // resolve it immediately, bypassing keyword branches and the hybrid LLM
  // clarifier entirely (a button tap is never ambiguous).
  if (step.type === 'single_choice' && interactiveReplyId) {
    const option = (step.options ?? []).find((o) => o.optionId === interactiveReplyId)
    if (option) {
      if (step.collect) {
        variables[step.collect] =
          step.storeAs === 'title' ? option.title : step.storeAs === 'saveValue' ? (option.saveValue ?? option.title) : option.optionId
      }
      return runFrom(flow, option.goToNext, variables)
    }
    // Stale/unknown id (flow edited after the message was sent) — fall through
    // to ordinary text matching below, same as a typed reply.
  }

  const routing = inspectFlowReply(flow, state, message)
  const target = routing?.matchedNext ?? routing?.fallbackNext ?? null
  if (target != null) return advanceFlowTo(flow, state, message, target)

  // Single Choice with no match at all (no keyword branch, no fallback): re-prompt
  // up to maxRetries, then route to onFailNext. Legacy steps keep today's exact
  // behavior — routing nowhere simply clears the cursor (return null) for the
  // caller to handle.
  if (step.type === 'single_choice') {
    const attempts = (state.retryCount ?? 0) + 1
    const max = step.maxRetries ?? DEFAULT_MAX_RETRIES
    if (attempts <= max) {
      const prompt = buildChoicePrompt(step, variables)
      return {
        messages: step.retryMessage ? [step.retryMessage] : prompt.messages,
        variables,
        nextStepId: step.id,
        action: null,
        awaitingInput: true,
        interactivePrompt: prompt.interactivePrompt,
        retryCount: attempts,
      }
    }
    return runFrom(flow, step.onFailNext ?? DEFAULT_ON_FAIL_NEXT, variables)
  }

  return null
}

/**
 * Advance through one of the waiting step's configured targets. This is the
 * only entry the hybrid classifier receives: a model-selected value is rejected
 * unless it exactly matches a real branch/default edge on the current step.
 */
export function advanceFlowTo(
  flow: FlowDef,
  state: FlowState,
  message: string,
  target: string,
): FlowRunResult | null {
  const step = findStep(flow, state.stepId)
  if (!step?.branches?.length) return null
  const allowedTargets = new Set([
    ...step.branches.map((branch) => branch.next),
    ...(step.next ? [step.next] : []),
  ])
  if (!allowedTargets.has(target)) return null

  const variables = { ...state.variables }
  if (step.collect) variables[step.collect] = message.trim()
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
