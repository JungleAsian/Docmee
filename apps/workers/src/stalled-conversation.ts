// Stalled conversation timer. When a conversation is mid-flow (the bot is actively
// waiting on a reply to a specific menu/question, via either the new workflow engine's
// pendingWorkflowRuns cursor or the older custom-flow engine's customFlowState cursor)
// and the patient goes silent past a configurable threshold, re-announce the exact
// last question/menu (verbatim, as plain text — see resolveMidFlowCursor for why a
// true interactive resend isn't attempted). After a configurable number of unanswered
// re-announcements, send a final notice, then auto-close after a further grace period.
//
// Runs as a 4th check inside timeout-monitor.ts's existing 5-minute poll — no new
// scheduling infra. Decision logic is pure and exported separately from the impure
// DB/WhatsApp orchestration so it's directly unit-testable without mocking.
import {
  createConversationsRepository,
  createMessagesRepository,
  createClinicsRepository,
  createChannelAccountsRepository,
  createPatientsRepository,
  type Sql,
  type Patient,
  type ChannelAccount,
} from '@docmee/db'
import { readPendingWorkflowRuns } from './workflow-run.js'
import { activeWhatsAppAccount, resolveWhatsAppSender } from './meta-token.js'

type Language = 'es' | 'en'

const MIN_CANDIDATE_MINUTES = 1

// ── Config ──────────────────────────────────────────────────────────────────────

export interface StalledConversationConfig {
  stallMinutes: number
  maxReannouncements: number
  closeGraceMinutes: number
}

export const DEFAULT_STALLED_CONVERSATION_CONFIG: StalledConversationConfig = {
  stallMinutes: 10,
  maxReannouncements: 3,
  closeGraceMinutes: 5,
}

/** Reads clinic.settings.stalledConversation, filling in any missing/invalid field
 *  with the default. Never throws on malformed settings. */
export function resolveStalledConversationConfig(settings: unknown): StalledConversationConfig {
  const raw = (settings as { stalledConversation?: Record<string, unknown> } | null | undefined)
    ?.stalledConversation
  const positiveInt = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
  return {
    stallMinutes: positiveInt(raw?.['stallMinutes'], DEFAULT_STALLED_CONVERSATION_CONFIG.stallMinutes),
    maxReannouncements: positiveInt(
      raw?.['maxReannouncements'],
      DEFAULT_STALLED_CONVERSATION_CONFIG.maxReannouncements,
    ),
    closeGraceMinutes: positiveInt(
      raw?.['closeGraceMinutes'],
      DEFAULT_STALLED_CONVERSATION_CONFIG.closeGraceMinutes,
    ),
  }
}

// ── Persisted state (conversations.metadata.stalledConversation) ──────────────────

const STALL_STATE_KEY = 'stalledConversation'

export interface StalledConversationState {
  /** Identity of the mid-flow cursor this state was raised against, e.g.
   *  "workflow:<workflowId>:<resumeNodeId>" or "customflow:<flowId>:<stepId>". A
   *  changed identity means the flow moved on to a NEW question — the counter resets. */
  cursorId: string
  /** How many re-announcements have been sent for this cursorId so far. */
  reannounceCount: number
  finalNoticeAt: string | null
}

export function readStalledConversationState(
  metadata: Record<string, unknown>,
): StalledConversationState | null {
  const raw = metadata[STALL_STATE_KEY]
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s['cursorId'] !== 'string' || typeof s['reannounceCount'] !== 'number') return null
  return {
    cursorId: s['cursorId'],
    reannounceCount: Math.max(0, Math.floor(s['reannounceCount'])),
    finalNoticeAt: typeof s['finalNoticeAt'] === 'string' ? s['finalNoticeAt'] : null,
  }
}

export function writeStalledConversationState(
  metadata: Record<string, unknown>,
  state: StalledConversationState | null,
): Record<string, unknown> {
  const next = { ...metadata }
  if (state === null) delete next[STALL_STATE_KEY]
  else next[STALL_STATE_KEY] = state
  return next
}

// ── Mid-flow cursor resolution ─────────────────────────────────────────────────────

export interface MidFlowCursor {
  cursorId: string
}

/** Resolve the CURRENT mid-flow cursor from a conversation's metadata, or null if the
 *  conversation isn't mid-flow. Checks the new workflow engine's pendingWorkflowRuns
 *  first, then the older custom-flow engine's customFlowState (inline-validated here
 *  rather than importing agent-processor.worker.ts's private reader). */
export function resolveMidFlowCursor(metadata: Record<string, unknown>): MidFlowCursor | null {
  const pending = readPendingWorkflowRuns(metadata)
  const now = Date.now()
  const activeWorkflow = pending.find((entry) => Date.parse(entry.expiresAt) > now)
  if (activeWorkflow) {
    return { cursorId: `workflow:${activeWorkflow.workflowId}:${activeWorkflow.resumeNodeId}` }
  }
  const flow = metadata['customFlowState']
  if (flow && typeof flow === 'object') {
    const f = flow as Record<string, unknown>
    if (typeof f['flowId'] === 'string' && typeof f['stepId'] === 'string') {
      return { cursorId: `customflow:${f['flowId']}:${f['stepId']}` }
    }
  }
  return null
}

// ── Pure decision core ─────────────────────────────────────────────────────────────

export type StalledConversationAction =
  | { kind: 'none' }
  | { kind: 'reannounce'; nextState: StalledConversationState }
  | { kind: 'final_notice'; nextState: StalledConversationState }
  | { kind: 'close' }

export interface DecideStalledConversationInput {
  cursor: MidFlowCursor | null
  /** ISO created_at of the most recent message in the conversation (any role). */
  lastMessageAt: string
  priorState: StalledConversationState | null
  config: StalledConversationConfig
  /** Injectable for tests; the orchestrator passes Date.now(). */
  nowMs: number
}

export function decideStalledConversationAction(
  input: DecideStalledConversationInput,
): StalledConversationAction {
  const { cursor, lastMessageAt, priorState, config, nowMs } = input

  // Not mid-flow (patient answered, or no cursor at all) — nothing to send. Cleanup
  // of any lingering stall state for a resolved cursor is the orchestrator's job, not
  // this function's, to keep the branch tree here about ONE thing: what to send next.
  if (!cursor) return { kind: 'none' }

  const state: StalledConversationState =
    priorState && priorState.cursorId === cursor.cursorId
      ? priorState
      : { cursorId: cursor.cursorId, reannounceCount: 0, finalNoticeAt: null }

  if (state.finalNoticeAt) {
    const graceSilentMs = nowMs - Date.parse(state.finalNoticeAt)
    const graceMs = config.closeGraceMinutes * 60_000
    return graceSilentMs >= graceMs ? { kind: 'close' } : { kind: 'none' }
  }

  const silentMs = nowMs - Date.parse(lastMessageAt)
  const stallMs = config.stallMinutes * 60_000
  if (silentMs < stallMs) return { kind: 'none' }

  if (state.reannounceCount < config.maxReannouncements) {
    return { kind: 'reannounce', nextState: { ...state, reannounceCount: state.reannounceCount + 1 } }
  }

  return { kind: 'final_notice', nextState: { ...state, finalNoticeAt: new Date(nowMs).toISOString() } }
}

// ── Message builders ────────────────────────────────────────────────────────────────

/** Re-announcement: the exact last question/menu, verbatim, with a short "still
 *  there?" lead-in so the patient understands why they're seeing it again. */
export function reannouncementMessage(lastQuestionText: string, language: Language): string {
  const lead = language === 'es'
    ? 'Seguimos aquí. Solo para confirmar tu respuesta anterior:'
    : "We're still here. Just to follow up on the previous question:"
  return `${lead}\n\n${lastQuestionText}`
}

/** Sent once, after the last allowed re-announcement goes unanswered. */
export function finalNoticeMessage(language: Language): string {
  return language === 'es'
    ? 'No hemos recibido respuesta y la conversación ha estado inactiva por un tiempo. La cerraremos en unos minutos si no responde; si aún necesita ayuda, solo escríbanos de nuevo.'
    : "We haven't heard back and this conversation has been idle for a while. We'll close it in a few minutes if there's no reply — if you still need help, just message us again."
}

function getPatientLanguage(patient: Patient | null): Language {
  return (patient?.metadata as { language?: unknown } | undefined)?.language === 'en' ? 'en' : 'es'
}

// ── Impure orchestration ─────────────────────────────────────────────────────────────

export async function runStalledConversationCheck(sql: Sql): Promise<void> {
  const conversations = createConversationsRepository(sql)
  const messages = createMessagesRepository(sql)
  const clinics = createClinicsRepository(sql)
  const channelAccounts = createChannelAccountsRepository(sql)
  const patients = createPatientsRepository(sql)

  const configCache = new Map<string, StalledConversationConfig>()
  const accountCache = new Map<string, ChannelAccount | undefined>()

  const candidates = await conversations.listMidFlowCandidates(MIN_CANDIDATE_MINUTES)

  for (const conv of candidates) {
    try {
      const cursor = resolveMidFlowCursor(conv.metadata)
      const priorState = readStalledConversationState(conv.metadata)

      if (!cursor) {
        // Patient replied and the engine moved on (or the wait simply expired) since
        // this conversation became a candidate — clear any leftover stall state.
        if (priorState) {
          await conversations.update(conv.clinicId, conv.id, {
            metadata: writeStalledConversationState(conv.metadata, null),
          })
        }
        continue
      }

      if (!configCache.has(conv.clinicId)) {
        const clinic = await clinics.findById(conv.clinicId)
        configCache.set(conv.clinicId, resolveStalledConversationConfig(clinic?.settings))
      }
      const config = configCache.get(conv.clinicId)!

      const lastMessage = await messages.findLast(conv.clinicId, conv.id)
      if (!lastMessage) continue

      const action = decideStalledConversationAction({
        cursor,
        lastMessageAt: lastMessage.createdAt,
        priorState,
        config,
        nowMs: Date.now(),
      })

      if (action.kind === 'none') continue

      if (action.kind === 'close') {
        await conversations.update(conv.clinicId, conv.id, {
          status: 'resolved',
          metadata: writeStalledConversationState(conv.metadata, null),
        })
        continue
      }

      if (!accountCache.has(conv.clinicId)) {
        accountCache.set(conv.clinicId, activeWhatsAppAccount(await channelAccounts.listByClinic(conv.clinicId)))
      }
      const account = accountCache.get(conv.clinicId)
      const sendWhatsApp = resolveWhatsAppSender(account, conv.channelContactHandle)
      if (!account || !sendWhatsApp) {
        console.warn(
          `[stalled-conversation] no active WhatsApp account for clinic ${conv.clinicId}; skipping conversation ${conv.id}`,
        )
        continue
      }

      const patient = conv.patientId ? await patients.findById(conv.clinicId, conv.patientId) : null
      const language = getPatientLanguage(patient)
      const text =
        action.kind === 'reannounce'
          ? reannouncementMessage(lastMessage.content, language)
          : finalNoticeMessage(language)

      const wamid = await sendWhatsApp(text)

      await messages.create({
        conversationId: conv.id,
        clinicId: conv.clinicId,
        role: 'assistant',
        content: text,
        ...(wamid ? { channelMessageId: wamid } : {}),
        metadata: { channel: 'whatsapp', stalledConversation: action.kind },
      })

      await conversations.update(conv.clinicId, conv.id, {
        metadata: writeStalledConversationState(conv.metadata, action.nextState),
      })
    } catch (err) {
      // One conversation's failure must never abort the rest of the tick.
      console.error(
        `[stalled-conversation] check failed for conversation ${conv.id}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }
}
