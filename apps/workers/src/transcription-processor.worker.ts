// Consumes: transcription queue. Production voice-note pipeline (replaces the P01/P03 stub).
//
// Flow (per Decision: a voice note is treated exactly like the text the patient
// would have typed): download the WhatsApp audio → transcribe with Docmee's
// built-in transcriber →
// re-enqueue to the agent queue as a normal message. The provider stub keeps the
// whole path working offline (LLM_STUB=true).
//
// Resilience: each step is retried up to MAX_RETRIES with exponential backoff.
// If every attempt fails we record an operator-reviewable error and send the
// patient a short apology asking them to retype — we never leave them on read.
import { z } from 'zod'
import { type Job } from '@docmee/queue'
import { agentQueue } from '@docmee/queue'
import { downloadMedia } from '@docmee/channels'
import type { TranscriptionResult } from '@docmee/channels'
import { activeWhatsAppAccount, resolveWhatsAppSender } from './meta-token.js'
import {
  createServiceDbClient,
  createErrorReviewsRepository,
  createChannelAccountsRepository,
  createConversationsRepository,
  createMessagesRepository,
  createPatientsRepository,
} from '@docmee/db'
import { patientAllowsAutomation } from './automation-boundary.js'

// messageId is the inbound WhatsApp message id (wamid.*), not a DB uuid — keep it a
// plain string so real jobs from the conversation processor validate.
const TranscriptionJobSchema = z.object({
  clinicId: z.string().uuid(),
  patientId: z.string().uuid().optional(),
  patientWaId: z.string(),
  phoneNumberId: z.string().optional(),
  messageId: z.string(),
  mediaId: z.string(),
  mimeType: z.string().optional(),
  waAccessToken: z.string(),
  conversationId: z.string().uuid().optional(),
})

export type TranscriptionJob = z.infer<typeof TranscriptionJobSchema>

const MAX_RETRIES = 3
const DEFAULT_RETRY_DELAY_MS = 1000

function retryDelayMs(): number {
  const raw = Number(process.env['TRANSCRIPTION_RETRY_DELAY_MS'])
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_RETRY_DELAY_MS
}

const APOLOGY_TEXT = 'No pude procesar tu mensaje de voz. Por favor envíalo como texto.'

interface BuiltInTranscriberResponse {
  text?: string
  transcript?: string
  duration_seconds?: number
  durationSeconds?: number
  confidence?: number
  language?: string
  words?: Array<{ word: string; start: number; end: number; confidence: number }>
}

async function builtInTranscribe(
  audioBuffer: ArrayBuffer,
  mimeType: string,
  options: { language?: string } = {},
): Promise<TranscriptionResult> {
  if (process.env['LLM_STUB'] === 'true') {
    return {
      text: 'Transcripción de prueba del mensaje de voz.',
      language: options.language ?? 'es',
      duration_seconds: 1,
      confidence: 0.99,
      words: [],
    }
  }

  const endpoint = process.env['DOCMEE_BUILTIN_TRANSCRIBER_URL']
  if (!endpoint) {
    throw new Error('DOCMEE_BUILTIN_TRANSCRIBER_URL not set')
  }

  const form = new FormData()
  form.append('audio', new Blob([audioBuffer], { type: mimeType }), 'voice-note.ogg')
  form.append('mimeType', mimeType)
  if (options.language) form.append('language', options.language)

  const response = await fetch(endpoint, { method: 'POST', body: form })
  if (!response.ok) {
    throw new Error(`Built-in transcriber error ${response.status}: ${await response.text()}`)
  }

  const data = (await response.json()) as BuiltInTranscriberResponse
  const text = (data.text ?? data.transcript ?? '').trim()
  return {
    text,
    language: data.language ?? options.language ?? 'es',
    duration_seconds: Number(data.duration_seconds ?? data.durationSeconds ?? 0),
    confidence: Number(data.confidence ?? 0),
    words: Array.isArray(data.words) ? data.words : [],
  }
}

export async function processTranscriptionJob(job: Job): Promise<void> {
  const payload = TranscriptionJobSchema.parse(job.data)

  let result: TranscriptionResult | null = null
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 1. Download the audio from the WhatsApp Cloud API.
      const media = await downloadMedia(payload.mediaId, payload.waAccessToken)

      // 2. Transcribe with Docmee's built-in transcriber.
      result = await builtInTranscribe(media.buffer, media.mimeType, {
        language: 'es',
      })
      break // success — don't pay for another download/transcription
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.warn(
        `[transcription] attempt ${attempt}/${MAX_RETRIES} failed for ${payload.messageId}: ${lastError.message}`,
      )
      if (attempt < MAX_RETRIES) await sleep(retryDelayMs() * attempt)
    }
  }

  if (!result) {
    // All retries exhausted: log for operator review and apologise to the patient.
    await handleFailure(payload, lastError)
    return
  }

  // Req 8: an empty transcript (silence / non-speech audio) is dropped silently —
  // don't persist a blank inbox message or wake the bot with an empty turn.
  if (!result.text || result.text.trim() === '') {
    console.info('[transcription] empty transcript dropped', { messageId: payload.messageId })
    return
  }

  // 3. Cost tracking: surface audio minutes for the runtime cost ledger.
  console.info('[transcription] built-in transcriber usage', {
    clinicId: payload.clinicId,
    minutes: Number((result.duration_seconds / 60).toFixed(4)),
    confidence: result.confidence,
  })

  // 4. Persist the voice note + transcript (Req 8: transcript storage + inbox
  //    voice marker). This resolves/creates the patient's open conversation so the
  //    note shows up in the inbox as an `audio` message carrying its transcription.
  //    Persistence is the ownership boundary. If it fails, fail this job so BullMQ
  //    retries it; never send an unthreaded agent turn that can create a second
  //    conversation or duplicate reply.
  const stored = await storeVoiceNote(payload, result)

  // Voice-note transcription is still useful to the secretary, but human-only
  // patients must never reach the agent queue.
  if (!stored.automationAllowed) return

  // 5. Re-enqueue to the agent as if the patient had typed the transcript, threaded
  //    onto the same conversation so the bot reply stays in the inbox thread.
  await agentQueue.add('process', {
    clinicId: payload.clinicId,
    patientId: payload.patientId,
    patientWaId: payload.patientWaId,
    phoneNumberId: payload.phoneNumberId,
    message: result.text,
    waMessageId: payload.messageId,
    conversationId: stored.conversationId,
    isVoiceNote: true,
  }, { jobId: `agent-voice:${payload.clinicId}:${payload.messageId}` })
}

/**
 * Store the inbound voice note as an `audio` conversation message carrying the
 * built-in transcript, on the patient's open conversation (created if needed).
 * Returns the canonical conversation id. Persistence errors propagate to the queue
 * retry policy rather than allowing a second owner to recreate the thread.
 */
async function storeVoiceNote(
  payload: TranscriptionJob,
  result: TranscriptionResult,
): Promise<{ conversationId: string; automationAllowed: boolean }> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    const conversations = createConversationsRepository(sql)
    // Audio only reaches the transcription worker on WhatsApp (P14/P15 inbound is
    // text-only), so the conversation channel is always 'whatsapp' here.
    const existing =
      (payload.conversationId
        ? await conversations.findById(payload.clinicId, payload.conversationId)
        : null) ?? (await conversations.findOpenByContact(payload.clinicId, 'whatsapp', payload.patientWaId))

    const conversation =
      existing ??
      (await conversations.create({
        clinicId: payload.clinicId,
        patientId: payload.patientId,
        channel: 'whatsapp',
        channelContactHandle: payload.patientWaId,
      }))

    await createMessagesRepository(sql).create({
      conversationId: conversation.id,
      clinicId: payload.clinicId,
      role: 'user',
      content: result.text,
      contentType: 'audio',
      channelMessageId: payload.messageId,
      transcription: result.text,
      metadata: {
        isVoiceNote: true,
        mediaId: payload.mediaId,
        mimeType: payload.mimeType ?? null,
        durationSeconds: result.duration_seconds,
        confidence: result.confidence,
      },
    })

    const patient = payload.patientId
      ? await createPatientsRepository(sql).findById(payload.clinicId, payload.patientId)
      : null
    return {
      conversationId: conversation.id,
      // Missing or unresolved patient identity cannot establish automation
      // ownership. Preserve the transcript for staff, but fail closed before the
      // agent queue.
      automationAllowed: patientAllowsAutomation(patient),
    }
  } finally {
    await sql.end()
  }
}

async function handleFailure(payload: TranscriptionJob, lastError: Error | null): Promise<void> {
  const sql = createServiceDbClient({ url: process.env['DATABASE_URL'] ?? '' })
  try {
    await createErrorReviewsRepository(sql).create({
      clinicId: payload.clinicId,
      errorType: 'transcription_failure',
      errorMessage: lastError?.message ?? 'unknown transcription error',
      context: {
        mediaId: payload.mediaId,
        waMessageId: payload.messageId,
        conversationId: payload.conversationId ?? null,
      },
    })

    // Record the operational failure for staff, but do not auto-reply when the
    // secretary has placed this number in permanent human-only mode.
    // Fail closed when identity is absent: without a durable patient row we
    // cannot prove that this number is eligible for automation.
    if (!payload.patientId) return
    const patients = createPatientsRepository(sql)
    const patient = await patients.findById(payload.clinicId, payload.patientId)
    if (!patientAllowsAutomation(patient)) return

    // Send the apology on the clinic's active WhatsApp number. Failure here is
    // swallowed — we have already recorded the underlying problem.
    try {
      const accounts = await createChannelAccountsRepository(sql).listByClinic(payload.clinicId)
      const account = activeWhatsAppAccount(accounts, payload.phoneNumberId)
      const sendWhatsApp = resolveWhatsAppSender(account, payload.patientWaId, payload.waAccessToken)
      if (sendWhatsApp) {
        // Final ownership re-read immediately before provider invocation closes
        // the race with a secretary enabling permanent human-only mode.
        const latest = await patients.findById(payload.clinicId, payload.patientId)
        if (!patientAllowsAutomation(latest)) return
        await sendWhatsApp(APOLOGY_TEXT)
      }
    } catch (sendErr) {
      console.error('[transcription] failed to send apology:', sendErr)
    }
  } finally {
    await sql.end()
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
