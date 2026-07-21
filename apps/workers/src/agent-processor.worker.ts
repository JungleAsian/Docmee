// Consumes: agent queue.
// Classifies intent, routes to the correct platform agent (P03), then for the
// botbase route runs the clinic bot and replies on WhatsApp; for an outside-hours
// silence it collects the patient's name + reason (Decision 1). calbot/alertflow
// routes stay fan-out to their downstream queues.
import { z } from 'zod'
import {
  classifyIntent,
  chatComplete,
  defaultChatModel,
  type ChatProvider,
  type IntentProvider,
} from '@docmee/llm'
import { resolveClinicAiKey, resolveEmbedder } from './clinic-ai-key.js'
import { enqueueWorkflowRuns } from './workflow-run.js'
import {
  routeIntent,
  runClinicBot,
  searchKb,
  scopeKbToMessage,
  hasDoctorScopedChunks,
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
  isLikelyQuestion,
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
} from '@docmee/agents'
import { hybridClarificationMessage, resolveHybridFlowBranch } from './custom-flow-hybrid.js'
import { sendMessengerText, sendInstagramText } from '@docmee/channels'
import { activeWhatsAppAccount, readMetaToken, resolveWhatsAppSender } from './meta-token.js'
import { schedulingQueue, notificationQueue, type Job } from '@docmee/queue'
import {
  createServiceDbClient,
  createClinicsRepository,
  createChannelAccountsRepository,
  createPatientsRepository,
  createKnowledgeRepository,
  createDoctorsRepository,
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

  return { name: clinic.name, language, tone, rulesText }
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
  return { flowId: s.flowId, stepId: s.stepId, variables, clarificationCount }
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
            await emitFlowResult(sql, data, conversation, activeState.flowId, sendReply, {
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
    if (result) {
      await emitFlowResult(sql, data, conversation, activeState.flowId, sendReply, result)
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
  await emitFlowResult(sql, data, conversation, matched.id, sendReply, result)
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
  result: { messages: string[]; variables: Record<string, string>; nextStepId: string | null; awaitingInput: boolean; action: 'book' | 'handoff' | 'end' | null },
): Promise<void> {
  for (const text of result.messages) await sendReply(text)

  let persistedMetadata = conversation?.metadata
  if (data.conversationId && conversation) {
    const metadata: Record<string, unknown> = {
      ...conversation.metadata,
      lastIntent: 'custom_flow',
      customFlowId: flowId,
    }
    if (result.awaitingInput && result.nextStepId) {
      metadata[FLOW_STATE] = { flowId, stepId: result.nextStepId, variables: result.variables }
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
      await pauseBotForHandoff(
        createConversationsRepository(sql),
        data,
        persistedMetadata,
        'custom_flow_handoff',
      )
    }
    await notificationQueue.add('notify', { ...data, reason: 'human_handoff' })
  }
}

/** Remove a stale flow cursor so normal processing resumes on this turn. */
async function clearFlowState(sql: Sql, data: AgentJobData, conversation: Conversation): Promise<void> {
  if (!data.conversationId) return
  const metadata = { ...conversation.metadata }
  delete metadata[FLOW_STATE]
  await createConversationsRepository(sql).update(data.clinicId, data.conversationId, { metadata })
}

/**
 * Pause the bot for a human handoff (Rev1 #5/#6): flip the conversation to
 * `handoff` and stamp who/why so the inbox shows the bot is off and the timeout
 * monitor can later reactivate it. No-op when the job carries no conversation id.
 */
async function pauseBotForHandoff(
  conversations: ReturnType<typeof createConversationsRepository>,
  data: AgentJobData,
  currentMetadata: Record<string, unknown> | undefined,
  reason: string,
): Promise<void> {
  if (!data.conversationId) return
  await conversations.update(data.clinicId, data.conversationId, {
    status: 'handoff',
    metadata: {
      ...(currentMetadata ?? {}),
      [BOT_PAUSED_AT]: new Date().toISOString(),
      [HANDOFF_REASON]: reason,
    },
  })
}

export async function processAgentJob(job: Job): Promise<void> {
  const data = AgentJobSchema.parse(job.data)
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })

  try {
    const clinics = createClinicsRepository(sql)
    const channelAccounts = createChannelAccountsRepository(sql)
    const patients = createPatientsRepository(sql)
    const knowledge = createKnowledgeRepository(sql)
    const errorReviews = createErrorReviewsRepository(sql)

    const clinic = await clinics.findById(data.clinicId)
    if (!clinic) {
      console.warn(`[agent] unknown clinic ${data.clinicId}; dropping ${data.waMessageId}`)
      return
    }

    // Rev 3 ? fire any active "message keyword" automation workflows for this inbound.
    // Awaited (so the lookup finishes before sql closes) but gated + best-effort: with
    // no matching active workflow it's a single empty EXISTS query and a no-op, so this
    // never changes the reply path or existing behaviour.
    try {
      await enqueueWorkflowRuns(sql, data.clinicId, 'trigger.message_keyword', {
        sourceEventId: data.waMessageId,
        message: data.message,
        ...(data.patientId ? { patientId: data.patientId } : {}),
        ...(data.conversationId ? { conversationId: data.conversationId } : {}),
      })
    } catch (err) {
      console.error('[agent] workflow trigger enqueue failed:', err)
    }

    const account = activeWhatsAppAccount(await channelAccounts.listByClinic(data.clinicId), data.phoneNumberId)
    const patient = data.patientId ? await patients.findById(data.clinicId, data.patientId) : null

    // Channel-aware reply transport (WhatsApp account or Messenger Page token).
    const rawSendReply = resolveSendReply(data.channel, clinic, account, data.patientWaId)


    // Unified Inbox (Req 4): persist every outbound bot reply as an `assistant`
    // message so the inbox thread shows the bot's side. Wrapping the single send
    // transport captures ALL reply paths ? emergency reassurance, handoff ack,
    // custom-flow scripts, outside-hours collection and the botbase LLM answer ?
    // without threading persistence through each branch. Best-effort: a storage
    // failure is logged but never blocks delivery, and we only record a reply that
    // actually went out (persist after the send resolves).
    const messages = createMessagesRepository(sql)
    const sendReply: ((text: string) => Promise<void>) | null = rawSendReply
      ? async (text: string) => {
          // Meta error logs (Req 19/29): a channel send failure (expired/invalid
          // token, rate limit, malformed request) is recorded to error_reviews as
          // `meta_send_failure` for the Error Review area, then swallowed so a
          // single failed send neither crashes the worker nor triggers a full-job
          // retry that could double-send. The reply is only persisted to the inbox
          // thread when it actually went out.
          let channelMessageId: string | null = null
          try {
            channelMessageId = await rawSendReply(text)
          } catch (err) {
            console.error('[agent] Meta send failed:', err)
            await errorReviews
              .create({
                clinicId: data.clinicId,
                errorType: 'meta_send_failure',
                errorMessage: err instanceof Error ? err.message : String(err),
                context: {
                  conversationId: data.conversationId,
                  channel: data.channel,
                  recipient: data.patientWaId,
                  waMessageId: data.waMessageId,
                },
              })
              .catch((logErr) => console.error('[agent] failed to log Meta send error:', logErr))
            return
          }
          if (data.conversationId) {
            try {
              // Store the outbound wamid as channel_message_id so the delivery-status
              // worker can match Meta's sent/delivered/read/failed receipts back to
              // this reply (Req 3). Undefined for channels without a returned id.
              await messages.create({
                conversationId: data.conversationId,
                clinicId: data.clinicId,
                role: 'assistant',
                content: text,
                channelMessageId: channelMessageId ?? undefined,
              })
            } catch (err) {
              console.error('[agent] failed to persist outbound reply:', err)
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
        await pauseBotForHandoff(conversations, data, conversation.metadata, 'emergency')
      }
      await notificationQueue.add('notify', {
        clinicId: data.clinicId,
        conversationId: data.conversationId,
        reason: 'emergency',
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
        await pauseBotForHandoff(conversations, data, conversation.metadata, 'patient_request')
      }
      await notificationQueue.add('notify', {
        clinicId: data.clinicId,
        conversationId: data.conversationId,
        reason: 'human_handoff',
      })
      return
    }

    // P18 (Gap #34): custom flows run BEFORE intent classification. A keyword match
    // runs the clinic's scripted message sequence (and optional terminal action)
    // and skips the LLM entirely.
    if (sendReply && (await runMatchingCustomFlow(sql, data, patient, conversation, sendReply, clinic))) {
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
    const route = routeIntent(intent, { isInsideBusinessHours: insideHours, patientOptedOut })

    // Sentiment detection + intent persistence (Gap #30 / Gap #27 metrics). Both
    // hang off the conversation row, so they only run when we know which one.
    if (data.conversationId && conversation) {
      const upset = detectUpsetTone(data.message)

      await conversations.update(data.clinicId, data.conversationId, {
        metadata: { ...conversation.metadata, lastIntent: intent, lastUpset: upset },
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
          if (conversation) {
            await pauseBotForHandoff(conversations, data, conversation.metadata, 'emergency')
          }
        }
        await notificationQueue.add('notify', { ...data, reason: route.reason })
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
        if (!sendReply) {
          console.warn(`[agent] no reply transport for clinic ${data.clinicId} on ${data.channel}; cannot reply`)
          break
        }
        const allChunks = await knowledge.listEmbeddedChunks(data.clinicId)
        // Per-doctor FAQs (Req 30): when any document is doctor-scoped, restrict the
        // retrievable chunks to clinic-wide ones plus the doctor the patient named ?
        // so "Does Dr. Garc?a do video calls?" pulls Garc?a's FAQ but not L?pez's,
        // and a generic question never surfaces a doctor-specific FAQ. Only load the
        // doctor list when scoping is actually in play (back-compat / no extra query).
        let chunks = allChunks
        if (hasDoctorScopedChunks(allChunks)) {
          const doctors = await createDoctorsRepository(sql).listByClinic(data.clinicId)
          chunks = scopeKbToMessage(data.message, allChunks, doctors)
        }
        let kbHit = false

        // J.zel per-clinic identity for the AI fallback: the clinic's chosen model
        // and persona (Studio ? Automations ? AI Assistant). Flows, templates,
        // handoff and the medical-safety/anti-injection screens are unchanged ? this
        // only shapes the MODEL and VOICE of an AI-generated reply, never the control.
        const JZEL_PROVIDERS = ['claude', 'openai', 'custom', 'gemini']
        const jzelCfg = ((
          clinic.settings as {
            aiAssistant?: { chatProvider?: string; model?: string; baseURL?: string; persona?: string }
          }
        ).aiAssistant ?? {}) as {
          chatProvider?: string
          model?: string
          baseURL?: string
          persona?: string
        }
        const jzelProvider: ChatProvider =
          typeof jzelCfg.chatProvider === 'string' && JZEL_PROVIDERS.includes(jzelCfg.chatProvider)
            ? (jzelCfg.chatProvider as ChatProvider)
            : 'claude'
        const jzelModel =
          typeof jzelCfg.model === 'string' && jzelCfg.model.trim() !== ''
            ? jzelCfg.model.trim()
            : defaultChatModel(jzelProvider)
        const jzelBaseURL = typeof jzelCfg.baseURL === 'string' ? jzelCfg.baseURL.trim() : ''
        const jzelPersona = typeof jzelCfg.persona === 'string' ? jzelCfg.persona.trim() : ''
        const jzelKey = resolveClinicAiKey(clinic.settings, jzelProvider)
        const jzelBase = (
          system: string,
          userMessage: string,
          maxTokens?: number,
          h?: Array<{ role: 'user' | 'assistant'; content: string }>,
        ) =>
          chatComplete({
            provider: jzelProvider,
            system,
            message: userMessage,
            history: h ?? [],
            maxTokens,
            apiKey: jzelKey,
            model: jzelModel,
            baseURL: jzelBaseURL,
          })
        // Append the clinic persona AFTER the bot's own system prompt so the built-in
        // KB-grounding / medical-safety / anti-injection rules stay authoritative; the
        // persona only adds clinic-specific tone and phrasing.
        const jzelComplete = jzelPersona
          ? (
              system: string,
              userMessage: string,
              maxTokens?: number,
              h?: Array<{ role: 'user' | 'assistant'; content: string }>,
            ) =>
              jzelBase(
                `${system}\n\nClinic voice (tone and clinic-specific phrasing only ? keep every rule above):\n${jzelPersona}`,
                userMessage,
                maxTokens,
                h,
              )
          : jzelBase

        // CRE-45: short-term memory. Load the recent turns of this conversation so
        // the bot can resolve follow-ups ("and the price?", "what about Tuesday?")
        // against context. The current inbound message is excluded (it is passed as
        // input.message) and each turn is capped to keep the prompt bounded.
        let history: Array<{ role: 'user' | 'assistant'; content: string }> = []
        if (data.conversationId) {
          const recent = await createMessagesRepository(sql).listByConversation(
            data.clinicId,
            data.conversationId,
          )
          history = recent
            .filter((m) => m.channelMessageId !== data.waMessageId)
            .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'agent')
            .slice(-10)
            .map((m) => ({
              role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
              content: (m.content ?? '').slice(0, 1000),
            }))
            .filter((m) => m.content.trim().length > 0)
        }

        const botResult = await runClinicBot(
          {
            clinicId: data.clinicId,
            conversationId: data.conversationId ?? null,
            patientName: patient?.fullName ?? null,
            patientLanguage: getPatientLanguage(patient),
            isFirstMessage: data.isNewPatient ?? false,
            message: data.message,
            history,
            clinic: getClinicBotConfig(clinic),
          },
          {
            searchKb: async (query) => {
              const matches = await searchKb(query, chunks, resolveEmbedder(clinic.settings))
              if (matches.length > 0) kbHit = true
              return matches
            },
            complete: jzelComplete,
            sendText: (text) => sendReply(text),
            logError: (info) =>
              errorReviews
                .create({
                  clinicId: info.clinicId,
                  errorType: info.errorType,
                  errorMessage: info.message,
                  context: { conversationId: info.conversationId, rawMessage: info.rawMessage },
                })
                .then(() => {}),
          },
        )

        // Bilingual bot (Req 22): persist the language the bot actually replied in
        // (resolveLanguage honors a clinic-forced language over raw detection) so
        // subsequent turns stay consistent.
        await persistPatientLanguage(patients, data.clinicId, patient, botResult.language)

        // Medical-safety handoff (Req 20): the output screen inside runClinicBot
        // tripped ? the unsafe LLM reply was suppressed and a safe deferral sent
        // in its place. Pause the bot for a human, tag the conversation, and raise
        // a handoff alert so a person takes over (and the safety event is already
        // logged to the Error Review area by the bot). We re-read the conversation
        // so the pause merges onto the latest metadata (the sentiment block above
        // just wrote to it).
        if (botResult.triggeredHandoff) {
          const handoffReason = botResult.handoffReason ?? 'medical_safety'
          if (data.conversationId && conversation) {
            const latest = await conversations.findById(data.clinicId, data.conversationId)
            // Only a real safety event carries the medical_safety tag; a knowledge-gap
            // (low-confidence) handoff is a routine "couldn't answer ? human" case.
            if (handoffReason === 'medical_safety') {
              const tag = await conversations.createTag({ clinicId: data.clinicId, name: 'medical_safety' })
              await conversations.addTag(data.clinicId, data.conversationId, tag.id)
            }
            await pauseBotForHandoff(
              conversations,
              data,
              latest?.metadata ?? conversation.metadata,
              'medical_safety',
            )
          }
          await notificationQueue.add('notify', {
            clinicId: data.clinicId,
            conversationId: data.conversationId,
            reason: 'human_handoff',
          })
          // ? Knowledge-gap handoff: the bot found no KB grounding for a real
          // question and deferred to a human. Log it for the Add-to-KB queue (Req 29)
          // ? the reply path's unanswered logging is skipped because we break here.
          if (handoffReason === 'low_confidence') {
            await errorReviews
              .create({
                clinicId: data.clinicId,
                errorType: 'unanswered_question',
                errorMessage: data.message,
                context: {
                  conversationId: data.conversationId,
                  channel: data.channel,
                  language: botResult.language,
                  kbChunks: chunks.length,
                  reason: 'low_confidence_handoff',
                },
              })
              .catch((err) => console.error('[agent] failed to log low-confidence handoff:', err))
          }
          break
        }

        // Unanswered question (Req 29 Error Review): the bot replied but found NO
        // clinic-KB match, so the answer was ungrounded ? exactly the case an
        // operator should review and (via the Add-to-KB path) turn into approved
        // content. Gated by isLikelyQuestion so greetings/thanks don't flood the
        // queue. Best-effort: a logging failure never affects the patient reply.
        if (botResult.replied && !kbHit && isLikelyQuestion(data.message)) {
          await errorReviews
            .create({
              clinicId: data.clinicId,
              errorType: 'unanswered_question',
              errorMessage: data.message,
              context: {
                conversationId: data.conversationId,
                channel: data.channel,
                language: botResult.language,
                kbChunks: chunks.length,
              },
            })
            .catch((err) => console.error('[agent] failed to log unanswered question:', err))
        }

        // Record KB usage for the analytics KB-hit rate (Gap #39). Re-read so we
        // merge onto the metadata the sentiment block just persisted.
        if (kbHit && data.conversationId) {
          const existing = await conversations.findById(data.clinicId, data.conversationId)
          if (existing) {
            await conversations.update(data.clinicId, data.conversationId, {
              // ? Citations: record which KB entries grounded the bot's reply so the
              // inbox can show "grounded in ?" for trust + audit.
              metadata: { ...existing.metadata, kbHit: true, kbCitations: botResult.citations },
            })
          }
        }
        break
      }
    }
  } finally {
    await sql.end()
  }
}
