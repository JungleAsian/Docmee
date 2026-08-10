// Consumes: agent queue.
// Classifies intent, routes to the correct platform agent (P03); the botbase
// route (general/unclear intent, inside business hours) sends a static nudge
// toward the clinic's structured keyword entry points instead of a free-form
// LLM answer. For an outside-hours silence it collects the patient's name +
// reason (Decision 1). calbot/alertflow routes stay fan-out to their
// downstream queues.
import { z } from 'zod'
import {
  classifyIntent,
  chatComplete,
  defaultChatModel,
  type ChatProvider,
  type IntentProvider,
} from '@docmee/llm'
import { resolveClinicAiKey } from './clinic-ai-key.js'
import { enqueueInboundWorkflowRuns, enqueueWorkflowRuns } from './workflow-run.js'
import {
  orchestrateConversation,
  isInsideBusinessHours,
  detectLanguage,
  matchCustomFlow,
  startFlow,
  advanceFlow,
  advanceFlowTo,
  inspectFlowReply,
  toFlowDef,
  isBotPaused,
  detectHumanRequest,
  isEmergencyMessage,
  emergencyNotice,
  handoffNotice,
  isOptOutMessage,
  isOptInMessage,
  optInConfirmation,
  BOT_PAUSED_AT,
  HANDOFF_REASON,
  type BusinessHours,
  type ClinicBotConfig,
  type Language,
  type FlowState,
  type FlowInteractivePrompt,
} from '@docmee/agents'
import { hybridClarificationMessage, resolveHybridFlowBranch } from './custom-flow-hybrid.js'
import { pauseBotForHandoff } from './bot-handoff.js'
import { sendMessengerText, sendInstagramText } from '@docmee/channels'
import { activeWhatsAppAccount, readMetaToken, resolveWhatsAppSender, resolveWhatsAppInteractiveSender } from './meta-token.js'
import { schedulingQueue, notificationQueue, type Job } from '@docmee/queue'
import {
  createServiceDbClient,
  createClinicsRepository,
  createChannelAccountsRepository,
  createPatientsRepository,
  createErrorReviewsRepository,
  createConversationsRepository,
  createMessagesRepository,
  createCustomFlowsRepository,
  type Sql,
  type Clinic,
  type Patient,
  type ChannelAccount,
  type Conversation,
} from '@docmee/db'

const AgentJobSchema = z.object({
  clinicId: z.string().uuid(),
  channel: z.enum(['whatsapp', 'messenger', 'instagram']).optional().default('whatsapp'),
  phoneNumberId: z.string().optional(),
  patientWaId: z.string(),
  message: z.string(),
  waMessageId: z.string(),
  patientId: z.string().uuid().optional(),
  isNewPatient: z.boolean().optional(),
  conversationId: z.string().uuid().optional(),
  // Single Choice (Punchlist Aug 3 parity spec): the stable id of a tapped
  // WhatsApp button/list row, when this turn is an interactive reply — lets the
  // flow engine route on the id instead of fuzzy-matching the tapped title.
  interactiveReplyId: z.string().optional(),
})

export type AgentJobData = z.infer<typeof AgentJobSchema>

// ?? Clinic / patient settings extraction ????????????????????????????????????????
// Clinic bot config and business hours live in clinics.settings (jsonb); patient
// language + opt-out live in patients.metadata. All parsing is defensive.

function getBusinessHours(clinic: Clinic): BusinessHours | null {
  const hours = (clinic.settings as { businessHours?: unknown }).businessHours
  return hours && typeof hours === 'object' ? (hours as BusinessHours) : null
}

/**
 * Read the bot configuration the Admin Studio clinic-detail page persists.
 *
 * Clinic-Specific Rules / Bot Tone Control (Req 27 / Req 26): the Studio UI saves
 * the bot tone and clinic rules as FLAT keys on clinics.settings ? settings.botTone
 * and settings.clinicRules (mirroring settings.businessHours) ? but this reader used
 * to look for them nested under settings.bot.{tone,rulesText}. Those keys were never
 * written, so the configured tone and clinic rules NEVER reached the bot prompt: the
 * bot always ran with the default professional tone and no clinic rules at all. We
 * now read the flat keys the UI actually writes, while still honoring the legacy
 * nested settings.bot.* shape if present. An empty rules string collapses to null so
 * a blank textarea doesn't inject an empty "Clinic rules:" line.
 */
export function getClinicBotConfig(clinic: Clinic): ClinicBotConfig {
  const settings = clinic.settings as {
    botTone?: unknown
    clinicRules?: unknown
    botLanguage?: unknown
    bot?: Record<string, unknown>
  }
  const legacy = settings.bot ?? {}

  const toneRaw = settings.botTone ?? legacy.tone
  const tone = toneRaw === 'friendly' || toneRaw === 'brief' ? toneRaw : 'professional'

  const langRaw = settings.botLanguage ?? legacy.language
  const language = langRaw === 'es' || langRaw === 'en' ? langRaw : 'auto'

  const rulesRaw = settings.clinicRules ?? legacy.rulesText
  const rulesText =
    typeof rulesRaw === 'string' && rulesRaw.trim() !== '' ? rulesRaw.trim() : null

  return {
    name: clinic.name,
    language,
    tone,
    rulesText,
    address: clinic.address,
    phone: clinic.phone,
    clinicType: clinic.clinicType,
  }
}

function getPatientLanguage(patient: Patient | null): Language {
  const lang = patient ? (patient.metadata as { language?: unknown }).language : undefined
  return lang === 'en' ? 'en' : 'es'
}

function isPatientOptedOut(patient: Patient | null): boolean {
  return patient ? (patient.metadata as { optedOut?: unknown }).optedOut === true : false
}

/**
 * Meta Compliance (Req 19): persist the patient's STOP/START decision to
 * patients.metadata so it sticks across turns. Previously a STOP was routed to
 * silence for that one message but never stored, so the patient was re-engaged on
 * their next message ? breaking the opt-out. Idempotent (skips when unchanged) and
 * a no-op for an unknown (null) patient. Stamps optedOutAt when opting out.
 */
async function setPatientOptedOut(
  patients: ReturnType<typeof createPatientsRepository>,
  clinicId: string,
  patient: Patient | null,
  optedOut: boolean,
): Promise<void> {
  if (!patient) return
  const current = (patient.metadata as { optedOut?: unknown }).optedOut === true
  if (current === optedOut) return
  const metadata: Record<string, unknown> = { ...patient.metadata, optedOut }
  if (optedOut) metadata['optedOutAt'] = new Date().toISOString()
  await patients.update(clinicId, patient.id, { metadata })
}

/**
 * Bilingual bot (Req 22): persist the patient's language to patients.metadata so
 * every later turn replies in the SAME language. Without this, getPatientLanguage
 * falls back to 'es' on message 2+ and an English-speaking patient is answered in
 * Spanish after their first message. Idempotent: only writes when the stored value
 * actually changes, and is a no-op for an unknown (null) patient.
 */
async function persistPatientLanguage(
  patients: ReturnType<typeof createPatientsRepository>,
  clinicId: string,
  patient: Patient | null,
  language: Language,
): Promise<void> {
  if (!patient) return
  const current = (patient.metadata as { language?: unknown }).language
  if (current === language) return
  await patients.update(clinicId, patient.id, {
    metadata: { ...patient.metadata, language },
  })
}

/**
 * Resolve the outbound reply transport for the message's channel. Returns null
 * when the clinic has no usable credentials (WhatsApp account inactive, or
 * Messenger/Instagram not connected) ? the caller then stays silent.
 *
 * The transport resolves to the provider message id (the WhatsApp wamid, or the
 * Messenger / Instagram `mid`) when the channel surfaces one, so the caller can
 * store it on the persisted reply and later match delivery-status receipts to it
 * (Req 3/33/34).
 */
function resolveSendReply(
  channel: 'whatsapp' | 'messenger' | 'instagram',
  clinic: Clinic,
  account: ChannelAccount | undefined,
  recipient: string,
): ((text: string) => Promise<string | null>) | null {
  if (channel === 'messenger') {
    const token = clinic.messengerEnabled ? readMetaToken(clinic.messengerPageAccessTokenEncrypted) : null
    if (!token) return null
    // Returns the Messenger mid so delivery/read receipts can be matched back (Req 33).
    return (text) => sendMessengerText(token, recipient, text)
  }
  if (channel === 'instagram') {
    const token = clinic.instagramEnabled ? readMetaToken(clinic.instagramPageAccessTokenEncrypted) : null
    if (!token) return null
    // Returns the Instagram mid so delivery/read receipts can be matched back (Req 34).
    return (text) => sendInstagramText(token, recipient, text)
  }
  if (!account) return null
  return resolveWhatsAppSender(account, recipient)
}

// ── Sentiment detection (Gap #30) ───────────────────────────────────────────────
// Cheap keyword match — no extra LLM call. An upset patient is tagged and a human
// handoff alert is fired so a secretary can step in.
const UPSET_KEYWORDS = [
  'molesto', 'enojado', 'terrible', 'horrible', 'pésimo',
  'angry', 'upset', 'awful',
  'no funciona', 'mentira', 'estafa',
]

export function detectUpsetTone(message: string): boolean {
  const lower = message.toLowerCase()
  return UPSET_KEYWORDS.some((k) => lower.includes(k))
}

function outsideHoursMessage(language: Language): string {
  return language === 'es'
    ? 'Estamos fuera de horario. Déjame tu nombre y el motivo de tu consulta y te contactamos mañana.'
    : 'We are outside business hours. Please leave your name and reason for your inquiry and we will contact you tomorrow.'
}

// Sent when an inbound message matches no configured workflow/custom-flow keyword
// trigger at all — independent of business hours, and independent of whatever the
// LLM intent classifier would have guessed. Replaces the general J.zel/botbase
// fallback for this turn: the patient is funneled toward the clinic's structured
// entry points instead of getting a free-form AI answer. The pre-LLM emergency and
// human-handoff keyword guards run earlier in this function and are unaffected —
// only the *general* Q&A fallback is replaced here.
function unmatchedKeywordMessage(language: Language): string {
  return language === 'es'
    ? 'Por favor, inicia tu mensaje escribiendo Menú o Reserva.'
    : 'Please start message by sending Menu or Booking.'
}

// Metadata key holding the in-progress flow cursor between turns (Rev1 #28).
const FLOW_STATE = 'customFlowState'

/** Read a persisted flow cursor off a conversation's metadata, validating shape. */
function readFlowState(metadata: Record<string, unknown> | undefined): FlowState | null {
  const raw = metadata?.[FLOW_STATE]
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (typeof s.flowId !== 'string' || typeof s.stepId !== 'string') return null
  const variables =
    s.variables && typeof s.variables === 'object'
      ? (s.variables as Record<string, string>)
      : {}
  const clarificationCount =
    typeof s.clarificationCount === 'number' && Number.isInteger(s.clarificationCount)
      ? Math.max(0, s.clarificationCount)
      : 0
  // Single Choice (Punchlist Aug 3 parity spec) — unmatched-reply attempts so
  // far at that step; omitted for every other step (see emitFlowResult).
  const retryCount = typeof s.retryCount === 'number' ? s.retryCount : undefined
  return { flowId: s.flowId, stepId: s.stepId, variables, clarificationCount, ...(retryCount !== undefined ? { retryCount } : {}) }
}

function flowBranchCompletion(clinic: Clinic) {
  const cfg = ((clinic.settings as {
    aiAssistant?: { chatProvider?: string; model?: string; baseURL?: string }
  }).aiAssistant ?? {})
  const providers = ['claude', 'openai', 'custom', 'gemini']
  const provider: ChatProvider =
    typeof cfg.chatProvider === 'string' && providers.includes(cfg.chatProvider)
      ? (cfg.chatProvider as ChatProvider)
      : 'claude'
  const model = typeof cfg.model === 'string' && cfg.model.trim()
    ? cfg.model.trim()
    : defaultChatModel(provider)

  return (system: string, message: string, maxTokens: number) =>
    chatComplete({
      provider,
      system,
      message,
      maxTokens,
      apiKey: resolveClinicAiKey(clinic.settings, provider),
      model,
      baseURL: typeof cfg.baseURL === 'string' ? cfg.baseURL.trim() : undefined,
    })
}

/**
 * P18 (Gap #34) / Rev1 #28: drive the custom-flow EXECUTION ENGINE.
 *
 * Two entry points, in priority order:
 *  1. RESUME ? if the conversation is mid-flow (a cursor is persisted in its
 *     metadata), advance that flow with this message: collect/branch/auto-advance,
 *     send the step's messages, persist the new cursor (or clear it when the flow
 *     ends) and fire any terminal action. A reply that routes nowhere clears the
 *     cursor and falls through to normal processing.
 *  2. START ? otherwise, if an enabled flow's trigger keyword matches, start that
 *     flow from its first step.
 *
 * Returns true when the flow handled the turn (caller skips the LLM).
 */
async function runMatchingCustomFlow(
  sql: Sql,
  data: AgentJobData,
  patient: Patient | null,
  conversation: Conversation | null,
  sendReply: (text: string) => Promise<void>,
  sendInteractive: ((prompt: FlowInteractivePrompt) => Promise<void>) | null,
  clinic: Clinic,
): Promise<boolean> {
  const flowsRepo = createCustomFlowsRepository(sql)

  // 1. Resume an in-progress flow.
  const activeState = conversation ? readFlowState(conversation.metadata) : null
  if (activeState && conversation) {
    const flowRow = await flowsRepo.findById(data.clinicId, activeState.flowId)
    let result: ReturnType<typeof advanceFlow> = null
    if (flowRow?.enabled) {
      const flow = toFlowDef(flowRow)
      const activeStep = flow.steps.find((s) => s.id === activeState.stepId)

      if (activeStep?.type === 'single_choice') {
        // Single Choice (Punchlist Aug 3 parity spec) owns its own deterministic
        // routing — tapped option id -> keyword fallback -> retry/onFailNext (see
        // flow-engine.ts). It never needs the hybrid LLM clarifier below: a tap is
        // unambiguous, and the spec's "conditions" fallback is a plain keyword
        // match, not free-form disambiguation.
        result = advanceFlow(flow, activeState, data.message, data.interactiveReplyId)
      } else {
        const routing = inspectFlowReply(flow, activeState, data.message)
        if (routing?.matchedNext) {
          result = advanceFlowTo(flow, activeState, data.message, routing.matchedNext)
        } else if (routing && routing.candidates.length > 0) {
          const decision = await resolveHybridFlowBranch({
            message: data.message,
            candidates: routing.candidates,
            complete: flowBranchCompletion(clinic),
          })
          if (decision.kind === 'route') {
            result = advanceFlowTo(flow, activeState, data.message, decision.next)
          } else {
            const language = data.isNewPatient ? detectLanguage(data.message) : getPatientLanguage(patient)
            if ((activeState.clarificationCount ?? 0) >= 1) {
              await sendReply(handoffNotice(language))
              await emitFlowResult(sql, data, conversation, activeState.flowId, sendReply, sendInteractive, {
                messages: [],
                variables: activeState.variables,
                nextStepId: null,
                awaitingInput: false,
                action: 'handoff',
              })
            } else {
              await sendReply(hybridClarificationMessage(routing.candidates, language))
              await persistFlowState(sql, data, conversation, {
                ...activeState,
                clarificationCount: 1,
              })
            }
            return true
          }
        } else {
          result = advanceFlow(flow, activeState, data.message)
        }
      }
    }
    if (result) {
      await emitFlowResult(sql, data, conversation, activeState.flowId, sendReply, sendInteractive, result)
      return true
    }
    // Flow gone/disabled, or the reply routed nowhere: clear the stale cursor and
    // let the trigger match below (or the LLM) handle this turn.
    await clearFlowState(sql, data, conversation)
  }

  // 2. Start a new flow on a trigger match.
  const flows = await flowsRepo.listEnabled(data.clinicId)
  if (flows.length === 0) return false

  const language = data.isNewPatient ? detectLanguage(data.message) : getPatientLanguage(patient)
  const matched = matchCustomFlow(
    data.message,
    flows.map((f) => ({
      id: f.id,
      triggerKeywords: f.triggerKeywords,
      messages: f.messages,
      action: f.action,
      language: f.language,
    })),
    language,
  )
  if (!matched) return false

  const flowRow = flows.find((f) => f.id === matched.id)!
  const result = startFlow(toFlowDef(flowRow))
  await emitFlowResult(sql, data, conversation, matched.id, sendReply, sendInteractive, result)
  return true
}

async function persistFlowState(
  sql: Sql,
  data: AgentJobData,
  conversation: Conversation,
  state: FlowState,
): Promise<void> {
  if (!data.conversationId) return
  await createConversationsRepository(sql).update(data.clinicId, data.conversationId, {
    metadata: {
      ...conversation.metadata,
      lastIntent: 'custom_flow_clarification',
      [FLOW_STATE]: state,
    },
  })
}

/** Send a flow run's messages, persist/clear its cursor, and fire its action. */
async function emitFlowResult(
  sql: Sql,
  data: AgentJobData,
  conversation: Conversation | null,
  flowId: string,
  sendReply: (text: string) => Promise<void>,
  sendInteractive: ((prompt: FlowInteractivePrompt) => Promise<void>) | null,
  result: {
    messages: string[]
    variables: Record<string, string>
    nextStepId: string | null
    awaitingInput: boolean
    action: 'book' | 'handoff' | 'end' | null
    interactivePrompt?: FlowInteractivePrompt
    retryCount?: number
  },
): Promise<void> {
  // Single Choice: prefer a real tappable WhatsApp interactive send. A failure
  // (transient Meta error, no interactive transport for this channel) falls
  // back to the plain-text rendering so the patient is never left with nothing.
  if (result.interactivePrompt && sendInteractive) {
    try {
      await sendInteractive(result.interactivePrompt)
    } catch (err) {
      console.error('[agent] interactive send failed, falling back to plain text:', err)
      for (const text of result.messages) await sendReply(text)
    }
  } else {
    for (const text of result.messages) await sendReply(text)
  }

  let persistedMetadata = conversation?.metadata
  if (data.conversationId && conversation) {
    const metadata: Record<string, unknown> = {
      ...conversation.metadata,
      lastIntent: 'custom_flow',
      customFlowId: flowId,
    }
    if (result.awaitingInput && result.nextStepId) {
      metadata[FLOW_STATE] = {
        flowId,
        stepId: result.nextStepId,
        variables: result.variables,
        // Only single_choice retries ever set this — omit it entirely for
        // every other step so legacy flow cursors persist byte-identical to
        // before this field existed.
        ...(result.retryCount !== undefined ? { retryCount: result.retryCount } : {}),
      }
    } else {
      delete metadata[FLOW_STATE]
    }
    await createConversationsRepository(sql).update(data.clinicId, data.conversationId, { metadata })
    persistedMetadata = metadata
  }

  if (result.action === 'book') {
    await schedulingQueue.add('schedule', { ...data, action: 'book' })
  } else if (result.action === 'handoff') {
    if (conversation) {
      await pauseBotForHandoff(sql, data.clinicId, data.conversationId, persistedMetadata, 'custom_flow_handoff')
    }
    await notificationQueue.add('notify', {
      ...data,
      reason: 'human_handoff',
      idempotencyKey: `human_handoff:${data.conversationId ?? 'none'}:${data.waMessageId}`,
    })
  }
}

/** Remove a stale flow cursor so normal processing resumes on this turn. */
async function clearFlowState(sql: Sql, data: AgentJobData, conversation: Conversation): Promise<void> {
  if (!data.conversationId) return
  const metadata = { ...conversation.metadata }
  delete metadata[FLOW_STATE]
  await createConversationsRepository(sql).update(data.clinicId, data.conversationId, { metadata })
}

export async function processAgentJob(job: Job): Promise<void> {
  const data = AgentJobSchema.parse(job.data)
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })

  try {
    const clinics = createClinicsRepository(sql)
    const channelAccounts = createChannelAccountsRepository(sql)
    const patients = createPatientsRepository(sql)
    const errorReviews = createErrorReviewsRepository(sql)

    const clinic = await clinics.findById(data.clinicId)
    if (!clinic) {
      console.warn(`[agent] unknown clinic ${data.clinicId}; dropping ${data.waMessageId}`)
      return
    }

    const account = activeWhatsAppAccount(await channelAccounts.listByClinic(data.clinicId), data.phoneNumberId)
    const patient = data.patientId ? await patients.findById(data.clinicId, data.patientId) : null

    // Channel-aware reply transport (WhatsApp account or Messenger Page token).
    const rawSendReply = resolveSendReply(data.channel, clinic, account, data.patientWaId)


    // Unified Inbox (Req 4): persist every outbound bot reply as an `assistant`
    // message so the inbox thread shows the bot's side. Wrapping the single send
    // transport captures ALL reply paths ? emergency reassurance, handoff ack,
    // custom-flow scripts, outside-hours collection and the botbase LLM answer ?
    // without threading persistence through each branch. The attempt is persisted before
    // transport so provider acceptance or rejection can be correlated to one row.
    const messages = createMessagesRepository(sql)
    const sendReply: ((text: string) => Promise<void>) | null = rawSendReply
      ? async (text: string) => {
          if (!data.conversationId) {
            throw new Error('Outbound delivery blocked: conversation is not durable')
          }
          const attempt = await messages.create({
            conversationId: data.conversationId,
            clinicId: data.clinicId,
            role: 'assistant',
            content: text,
            metadata: {
              outboundAttempt: true,
              sourceWaMessageId: data.waMessageId,
              providerAccepted: false,
            },
          })
          // Meta error logs (Req 19/29): a channel send failure (expired/invalid
          // token, rate limit, malformed request) is recorded to error_reviews as
          // `meta_send_failure` for the Error Review area, then swallowed so a
          // single failed send neither crashes the worker nor triggers a full-job
          // retry that could double-send. The reply is only persisted to the inbox
          // thread when it actually went out.
          let channelMessageId: string | null = null
          try {
            channelMessageId = await rawSendReply(text)
            if (!channelMessageId) throw new Error('Provider accepted no message identifier')
          } catch (err) {
            console.error('[agent] Meta send failed:', err)
            const diagnostic = err instanceof Error ? err.message : String(err)
            await messages.markSendFailed(data.clinicId, attempt.id, diagnostic)
              .catch((logErr) => console.error('[agent] failed to record send failure:', logErr))
            await errorReviews
              .create({
                clinicId: data.clinicId,
                errorType: 'meta_send_failure',
                errorMessage: diagnostic,
                context: {
                  outboundMessageId: attempt.id,
                  conversationId: data.conversationId,
                  channel: data.channel,
                  recipient: data.patientWaId,
                  waMessageId: data.waMessageId,
                },
              })
              .catch((logErr) => console.error('[agent] failed to log Meta send error:', logErr))
            return
          }
          let acceptanceError: unknown
          for (let attemptNumber = 1; attemptNumber <= 3; attemptNumber += 1) {
            try {
              await messages.markProviderAccepted(data.clinicId, attempt.id, channelMessageId)
              acceptanceError = undefined
              break
            } catch (err) {
              acceptanceError = err
              console.error(`[agent] provider acceptance persistence failed (${attemptNumber}/3):`, err)
            }
          }
          if (acceptanceError) {
            const diagnostic = acceptanceError instanceof Error ? acceptanceError.message : String(acceptanceError)
            await errorReviews.create({
              clinicId: data.clinicId,
              errorType: 'provider_acceptance_persistence_failure',
              errorMessage: diagnostic,
              context: {
                outboundMessageId: attempt.id,
                conversationId: data.conversationId,
                channel: data.channel,
                providerMessageId: channelMessageId,
              },
            }).catch((logErr) => console.error('[agent] failed to log acceptance persistence error:', logErr))
          }
        }
      : null

    // Single Choice (Punchlist Aug 3 parity spec): a real tappable WhatsApp
    // interactive send, WhatsApp-only — Messenger/Instagram fall back to the
    // plain-text rendering in `sendReply` (see emitFlowResult). Unlike
    // `sendReply`, a failed send here is NOT swallowed: it propagates so the
    // caller can fall back to plain text rather than silently dropping the menu.
    const rawSendInteractive =
      data.channel === 'whatsapp' ? resolveWhatsAppInteractiveSender(account, data.patientWaId) : null
    const sendInteractive: ((prompt: FlowInteractivePrompt) => Promise<void>) | null = rawSendInteractive
      ? async (prompt) => {
          const channelMessageId = await rawSendInteractive(prompt)
          if (data.conversationId) {
            try {
              await messages.create({
                conversationId: data.conversationId,
                clinicId: data.clinicId,
                role: 'assistant',
                content: prompt.body,
                channelMessageId: channelMessageId ?? undefined,
              })
            } catch (err) {
              console.error('[agent] failed to persist outbound interactive reply:', err)
            }
          }
        }
      : null

    const conversations = createConversationsRepository(sql)
    const conversation = data.conversationId
      ? await conversations.findById(data.clinicId, data.conversationId)
      : null

    // Bot Interruption Rule (Rev1 #6): once a human owns the conversation
    // (assigned/handoff) or it is closed (resolved), the bot stays completely
    // silent ? no custom flow, no LLM, no auto-reply. Control returns to the bot
    // only when the conversation is reactivated to `open` (manual resume or the
    // reactivation timeout), at which point a later message routes normally.
    if (conversation && isBotPaused(conversation.status)) {
      console.log(`[agent] conversation ${conversation.id} is human-owned (${conversation.status}); bot silent`)
      return
    }

    const patientLanguage = data.isNewPatient
      ? detectLanguage(data.message)
      : getPatientLanguage(patient)

    // Bilingual bot (Req 22): capture the language from the patient's FIRST message
    // so every later turn ? and any non-bot route (calbot booking, alertflow) ? can
    // answer in the same language. The botbase route re-persists the bot's resolved
    // language below in case the clinic forces a fixed reply language.
    if (data.isNewPatient) {
      await persistPatientLanguage(patients, data.clinicId, patient, patientLanguage)
    }

    // Auto-tag a brand-new patient's conversation (Req 11). Runs on first contact,
    // before any routing branch returns, so the `new_patient` tag is applied no
    // matter how the message routes (bot / emergency / handoff). createTag upserts
    // and addTag is ON CONFLICT DO NOTHING, so this is idempotent.
    if (data.conversationId && conversation && data.isNewPatient) {
      const tag = await conversations.createTag({
        clinicId: data.clinicId,
        name: 'new_patient',
        color: '#16a34a',
      })
      await conversations.addTag(data.clinicId, data.conversationId, tag.id)
    }

    // Medical emergency (Req 20: emergency routing). A cheap pre-LLM keyword check
    // runs FIRST ? before business hours, opt-out, custom flows and intent
    // classification ? so a true emergency (chest pain, can't breathe, bleeding,
    // suicide?) is never silenced by the outside-hours rule, never waits on the
    // model, and is never answered by the bot. We reassure the patient and point
    // them at local emergency services, pause the bot, tag the conversation, and
    // raise the highest-priority alert. Safety overrides opt-out here by design.
    if (sendReply && isEmergencyMessage(data.message)) {
      await sendReply(emergencyNotice(patientLanguage))
      if (data.conversationId && conversation) {
        const tag = await conversations.createTag({ clinicId: data.clinicId, name: 'emergency' })
        await conversations.addTag(data.clinicId, data.conversationId, tag.id)
        await pauseBotForHandoff(sql, data.clinicId, data.conversationId, conversation.metadata, 'emergency')
      }
      await notificationQueue.add('notify', {
        clinicId: data.clinicId,
        conversationId: data.conversationId,
        reason: 'emergency',
        idempotencyKey: `emergency:${data.conversationId ?? 'none'}:${data.waMessageId}`,
      })
      return
    }

    // Consent / opt-out (Req 19 Meta Compliance). Deterministic keyword detection
    // runs before custom flows and intent classification so STOP/BAJA is honoured
    // even when the LLM is stubbed or misclassifies. STOP is absolute: we PERSIST
    // the opt-out to the patient (so every later turn stays silent via the router's
    // patientOptedOut gate), tag the conversation, and stay silent now. START
    // re-subscribes and confirms. Emergency safety still overrides opt-out ? the
    // emergency guard above runs first by design.
    const optedOutBefore = isPatientOptedOut(patient)

    if (isOptInMessage(data.message)) {
      if (patient && optedOutBefore) {
        await setPatientOptedOut(patients, data.clinicId, patient, false)
        if (sendReply) await sendReply(optInConfirmation(patientLanguage))
      }
      return
    }

    if (isOptOutMessage(data.message) || optedOutBefore) {
      if (patient && !optedOutBefore) {
        await setPatientOptedOut(patients, data.clinicId, patient, true)
        if (data.conversationId && conversation) {
          const tag = await conversations.createTag({ clinicId: data.clinicId, name: 'opted_out' })
          await conversations.addTag(data.clinicId, data.conversationId, tag.id)
        }
      }
      console.log(`[agent] opt-out: staying silent for clinic ${data.clinicId}`)
      return
    }

    // Explicit "connect me with a human" request (Rev1 #5). Cheap keyword check so
    // an unambiguous request hands off reliably without waiting on the LLM: ack the
    // patient, pause the bot (status ? handoff), and alert a human.
    if (sendReply && detectHumanRequest(data.message)) {
      await sendReply(handoffNotice(patientLanguage))
      if (conversation) {
        await pauseBotForHandoff(sql, data.clinicId, data.conversationId, conversation.metadata, 'patient_request')
      }
      await notificationQueue.add('notify', {
        clinicId: data.clinicId,
        conversationId: data.conversationId,
        reason: 'human_handoff',
        idempotencyKey: `human_handoff:${data.conversationId ?? 'none'}:${data.waMessageId}`,
      })
      return
    }

    // Keep replies inside an active scheduling conversation deterministic. A date
    // or time such as "2026-07-27" / "10:00" is not a fresh intent and must not
    // be reclassified by the general assistant. Safety, consent and explicit
    // human-handoff guards intentionally remain above this resume point.
    const activeScheduling = conversation?.metadata?.scheduling
    const activeSchedulingAction =
      activeScheduling &&
      typeof activeScheduling === 'object' &&
      'action' in activeScheduling &&
      ['book', 'reschedule', 'cancel', 'status'].includes(String(activeScheduling.action))
        ? (activeScheduling.action as 'book' | 'reschedule' | 'cancel' | 'status')
        : null
    if (activeSchedulingAction) {
      await schedulingQueue.add('schedule', { ...data, action: activeSchedulingAction })
      return
    }

    // Fire inbound workflows after the safety and consent guards above. A matched
    // CONVERSATIONAL workflow (menu / ask & capture / send message…) owns the
    // reply turn: it answers the patient itself, so custom flows and the LLM stay
    // silent this turn. Pure side-effect workflows (tag / notify / approval)
    // remain best-effort and never suppress the reply below.
    try {
      const claim = await enqueueInboundWorkflowRuns(sql, data.clinicId, {
        sourceEventId: data.waMessageId,
        message: data.message,
        ...(data.patientId ? { patientId: data.patientId } : {}),
        ...(data.conversationId ? { conversationId: data.conversationId } : {}),
      })
      if (claim.ownsTurn) return
    } catch (err) {
      console.error('[agent] workflow trigger enqueue failed:', err)
    }

    // P18 (Gap #34): custom flows run BEFORE intent classification. A keyword match
    // runs the clinic's scripted message sequence (and optional terminal action)
    // and skips the LLM entirely.
    if (sendReply && (await runMatchingCustomFlow(sql, data, patient, conversation, sendReply, sendInteractive, clinic))) {
      return
    }

    const patientOptedOut = isPatientOptedOut(patient)
    const insideHours = isInsideBusinessHours(getBusinessHours(clinic), clinic.timezone)

    // Intent provider is per-clinic (Studio ? Automations ? AI Assistant). DeepSeek by
    // default (server key); other providers use the clinic's connected key.
    const intentCfg = (clinic.settings as { aiAssistant?: { intentProvider?: string; baseURL?: string } })
      .aiAssistant ?? {}
    const INTENT_PROVIDERS = ['deepseek', 'claude', 'openai', 'custom', 'gemini']
    const intentProvider: IntentProvider =
      typeof intentCfg.intentProvider === 'string' && INTENT_PROVIDERS.includes(intentCfg.intentProvider)
        ? (intentCfg.intentProvider as IntentProvider)
        : 'deepseek'
    const intent = await classifyIntent(data.message, {
      provider: intentProvider,
      apiKey: intentProvider === 'deepseek' ? undefined : resolveClinicAiKey(clinic.settings, intentProvider),
      baseURL: typeof intentCfg.baseURL === 'string' ? intentCfg.baseURL.trim() : undefined,
    })
    const orchestration = orchestrateConversation(intent, {
      isInsideBusinessHours: insideHours,
      patientOptedOut,
    })
    const route = orchestration.route

    // Sentiment + bounded orchestration audit (Gap #30 / Gap #27 metrics). The
    // three patient-facing workflows are booking, human handoff and inquiry.
    // Policy-suppressed turns remain explicit rather than being mislabeled.
    let routedMetadata = conversation?.metadata
    if (data.conversationId && conversation) {
      const upset = detectUpsetTone(data.message)
      routedMetadata = {
        ...conversation.metadata,
        lastIntent: intent,
        lastOrchestrationRoute: orchestration.workflow ?? 'policy_suppressed',
        lastOrchestrationAt: new Date().toISOString(),
        lastUpset: upset,
      }

      await conversations.update(data.clinicId, data.conversationId, {
        metadata: routedMetadata,
      })

      if (upset) {
        // Tag the conversation and raise an UPSET_PATIENT alert (p1).
        const tag = await conversations.createTag({ clinicId: data.clinicId, name: 'patient_upset' })
        await conversations.addTag(data.clinicId, data.conversationId, tag.id)
        await notificationQueue.add('notify', {
          clinicId: data.clinicId,
          conversationId: data.conversationId,
          reason: 'upset',
        })
        // Rev 3 ? fire any active patient_upset automation workflows (gated + best-effort).
        try {
          await enqueueWorkflowRuns(sql, data.clinicId, 'trigger.patient_upset', {
            message: data.message,
            ...(data.patientId ? { patientId: data.patientId } : {}),
            conversationId: data.conversationId,
          })
        } catch (err) {
          console.error('[agent] patient_upset workflow enqueue failed:', err)
        }
      }
    }

    switch (route.agent) {
      case 'calbot':
        await schedulingQueue.add('schedule', { ...data, action: route.action })
        break

      case 'alertflow':
        // An emergency the keyword guard missed but the classifier caught still
        // needs the same patient-facing reassurance + bot pause as the keyword path
        // (the keyword check only fires on a fixed phrase list).
        if (route.reason === 'emergency') {
          if (sendReply) await sendReply(emergencyNotice(patientLanguage))
        } else if (sendReply) {
          // The AI classifier can recognize a natural handoff request that does
          // not match the high-precision phrase guard. Treat it exactly like an
          // explicit request: acknowledge it and stop all future bot replies.
          await sendReply(handoffNotice(patientLanguage))
        }
        if (conversation) {
          await pauseBotForHandoff(
            sql,
            data.clinicId,
            data.conversationId,
            routedMetadata,
            route.reason === 'emergency' ? 'emergency' : 'patient_request',
          )
        }
        await notificationQueue.add('notify', {
          ...data,
          reason: route.reason,
          idempotencyKey: `${route.reason}:${data.conversationId ?? 'none'}:${data.waMessageId}`,
        })
        break

      case 'silence':
        // Outside-hours: collect name + reason so a human can follow up (Decision 1).
        // Opt-out silence stays fully silent.
        if (route.reason === 'outside_hours' && sendReply) {
          await sendReply(outsideHoursMessage(patientLanguage))
        } else if (route.reason === 'opted_out') {
          // An opt-out the keyword guard missed but the classifier caught ? persist
          // it (Req 19) so it sticks, then stay silent.
          await setPatientOptedOut(patients, data.clinicId, patient, true)
          if (data.conversationId && conversation) {
            const tag = await conversations.createTag({ clinicId: data.clinicId, name: 'opted_out' })
            await conversations.addTag(data.clinicId, data.conversationId, tag.id)
          }
        } else {
          console.log('[agent] silence route:', route.reason, data.clinicId)
        }
        break

      case 'botbase': {
        // The general AI Q&A fallback (greeting / general_question / out_of_scope
        // intent, inside business hours -- the only way this route is ever reached)
        // is replaced with a static nudge toward the clinic's structured entry
        // points instead of a free-form LLM answer. Emergency, human-handoff,
        // booking, opt-out and outside-hours routing all happen upstream of this
        // switch and are completely unaffected.
        if (sendReply) {
          await sendReply(unmatchedKeywordMessage(patientLanguage))
        } else {
          console.warn(`[agent] no reply transport for clinic ${data.clinicId} on ${data.channel}; cannot reply`)
        }
        break
      }
    }
  } finally {
    await sql.end()
  }
}
