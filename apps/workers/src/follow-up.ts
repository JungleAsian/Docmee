// Follow-up automation (Rev1 #14) — pure helpers, message copy and producers.
//
// The seven follow-up types the clinic spec requires:
//   appointment_confirmation  — ~24h before the appointment ("please confirm")
//   appointment_reminder      — ~3h before the appointment ("reminder, today at …")
//   post_consultation         — ~2h after the appointment ("how did it go?")
//   seven_day                 — 7 days after the appointment (recovery check-in)
//   three_month               — 90 days after the appointment (re-activation/check-up)
//   review_request            — handled by the dedicated review-request worker
//   no_response               — the patient went quiet mid-conversation (nudge once)
//
// The first five are appointment-relative and are scheduled as delayed jobs the
// moment a booking is confirmed (scheduleAppointmentFollowUps). no_response is
// scheduled when a scheduling flow is left awaiting the patient. Each delayed job
// is delivered by processFollowUpJob (follow-up.worker.ts), which re-checks consent,
// the appointment's current status and the 24-hour customer-care window before it
// ever sends — so cancellations, opt-outs and replies all suppress a stale job.
import { z } from 'zod'
import { followUpQueue } from '@docmee/queue'
import type { MessageTemplateCategory } from '@docmee/db'

export const FOLLOW_UP_TYPES = {
  CONFIRMATION: 'appointment_confirmation',
  REMINDER: 'appointment_reminder',
  POST_CONSULTATION: 'post_consultation',
  SEVEN_DAY: 'seven_day',
  THREE_MONTH: 'three_month',
  REVIEW_REQUEST: 'review_request',
  NO_RESPONSE: 'no_response',
} as const

export type FollowUpType = (typeof FOLLOW_UP_TYPES)[keyof typeof FOLLOW_UP_TYPES]

export const FollowUpJobSchema = z.object({
  clinicId: z.string().uuid(),
  patientId: z.string().uuid(),
  type: z.enum([
    FOLLOW_UP_TYPES.CONFIRMATION,
    FOLLOW_UP_TYPES.REMINDER,
    FOLLOW_UP_TYPES.POST_CONSULTATION,
    FOLLOW_UP_TYPES.SEVEN_DAY,
    FOLLOW_UP_TYPES.THREE_MONTH,
    FOLLOW_UP_TYPES.REVIEW_REQUEST,
    FOLLOW_UP_TYPES.NO_RESPONSE,
  ]),
  /** Set for the five appointment-relative types; used for the cancellation guard + idempotency. */
  appointmentId: z.string().uuid().optional(),
  /** Set for no_response; used to dedupe one nudge per conversation. */
  conversationId: z.string().uuid().optional(),
  /** no_response self-cancel: the patient's last-inbound time when the job was scheduled. */
  silentSinceIso: z.string().optional(),
  /** Rev 2 Approval node: a re-enqueued job after a secretary approved the draft —
   *  skips the approval gate but re-runs every consent/window/anti-spam re-check. */
  approved: z.boolean().optional(),
  /** The pending_approval follow_ups row being approved (claimed atomically on send). */
  followUpId: z.string().uuid().optional(),
})

export type FollowUpJobData = z.infer<typeof FollowUpJobSchema>

type Language = 'es' | 'en'

export interface FollowUpContext {
  /** Localized date/time of the appointment, woven into reminder/confirmation copy. */
  when?: string
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** A no_response nudge fires ~20h after we last messaged the patient (still inside
 *  the 24h customer-care window, so a free-text nudge is allowed). */
export const NO_RESPONSE_DELAY_MS = 20 * HOUR_MS

// Appointment-relative fire times, keyed by type. Confirmation/reminder are relative
// to the START; the after-care types are relative to the END.
function appointmentFireTimes(start: number, end: number): Record<string, number> {
  return {
    [FOLLOW_UP_TYPES.CONFIRMATION]: start - 24 * HOUR_MS,
    [FOLLOW_UP_TYPES.REMINDER]: start - 3 * HOUR_MS,
    [FOLLOW_UP_TYPES.POST_CONSULTATION]: end + 2 * HOUR_MS,
    [FOLLOW_UP_TYPES.SEVEN_DAY]: end + 7 * DAY_MS,
    [FOLLOW_UP_TYPES.THREE_MONTH]: end + 90 * DAY_MS,
  }
}

export interface PlannedFollowUp {
  type: FollowUpType
  delayMs: number
}

/**
 * The appointment-relative follow-ups to schedule for one appointment, as delays
 * from `nowIso`. Fire times already in the past (e.g. a same-day booking, where the
 * 24h-before confirmation is already due) are skipped so we never fire immediately.
 */
export function computeAppointmentFollowUps(
  startIso: string,
  endIso: string,
  nowIso: string,
): PlannedFollowUp[] {
  const start = Date.parse(startIso)
  const end = Date.parse(endIso)
  const now = Date.parse(nowIso)
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(now)) return []

  const fireAt = appointmentFireTimes(start, end)
  return (Object.keys(fireAt) as FollowUpType[])
    .map((type) => ({ type, delayMs: fireAt[type]! - now }))
    .filter((p) => p.delayMs > 0)
}

/** Within Meta's 24-hour customer-care window? Outside it, only approved templates
 *  may be sent. A patient with no recorded inbound message is treated as outside. */
export function isWithinCustomerCareWindow(lastInboundIso: string | null, nowIso: string): boolean {
  if (!lastInboundIso) return false
  const last = Date.parse(lastInboundIso)
  const now = Date.parse(nowIso)
  if (Number.isNaN(last) || Number.isNaN(now)) return false
  return now - last < 24 * HOUR_MS
}

/** The approved-template category that may carry this follow-up outside the 24h
 *  window, or null when no template category applies (→ it can't be sent late). */
export function templateCategoryForType(type: FollowUpType): MessageTemplateCategory | null {
  if (type === FOLLOW_UP_TYPES.CONFIRMATION) return 'appointment_confirmation'
  if (type === FOLLOW_UP_TYPES.REMINDER) return 'appointment_reminder'
  return null
}

const COPY: Record<FollowUpType, Record<Language, (ctx: FollowUpContext) => string>> = {
  appointment_confirmation: {
    es: (c) =>
      `Hola, le recordamos su cita${c.when ? ` el ${c.when}` : ''}. ¿Podría confirmar su asistencia respondiendo SÍ? Si necesita cambiarla, responda a este mensaje.`,
    en: (c) =>
      `Hello, this is a confirmation for your appointment${c.when ? ` on ${c.when}` : ''}. Could you confirm by replying YES? If you need to change it, just reply to this message.`,
  },
  appointment_reminder: {
    es: (c) =>
      `Recordatorio: tiene una cita${c.when ? ` ${c.when}` : ''}. ¡Le esperamos! Si no puede asistir, avísenos por aquí.`,
    en: (c) =>
      `Reminder: you have an appointment${c.when ? ` ${c.when}` : ''}. We look forward to seeing you! If you can't make it, let us know here.`,
  },
  post_consultation: {
    es: () => 'Esperamos que su consulta haya ido bien. ¿Cómo se siente? Estamos aquí si necesita algo.',
    en: () => "We hope your consultation went well. How are you feeling? We're here if you need anything.",
  },
  seven_day: {
    es: () => 'Han pasado unos días desde su consulta. ¿Cómo ha evolucionado? Si tiene dudas, responda a este mensaje.',
    en: () => "It's been a few days since your consultation. How have you been? If you have any questions, reply to this message.",
  },
  three_month: {
    es: () => 'Han pasado unos meses desde su última visita. ¿Le gustaría agendar una revisión? Estamos para ayudarle.',
    en: () => "It's been a few months since your last visit. Would you like to schedule a check-up? We're happy to help.",
  },
  review_request: {
    es: () => '¡Gracias por su visita! Su opinión nos ayuda a mejorar. ¿Nos compartiría cómo fue su experiencia?',
    en: () => 'Thank you for your visit! Your feedback helps us improve. Would you share how your experience was?',
  },
  no_response: {
    es: () => 'Seguimos pendientes de su mensaje. ¿Aún podemos ayudarle con algo?',
    en: () => "We're still here for you. Is there anything else we can help you with?",
  },
}

/** The localized free-text body for a follow-up type (used inside the 24h window). */
export function followUpMessage(type: FollowUpType, language: Language, ctx: FollowUpContext = {}): string {
  return COPY[type][language](ctx)
}

// ── Producers ──────────────────────────────────────────────────────────────────

/** Schedule a single follow-up to fire after `delayMs`. */
export async function scheduleFollowUp(data: FollowUpJobData, delayMs: number): Promise<void> {
  await followUpQueue.add('follow-up', data, { delay: Math.max(0, Math.round(delayMs)) })
}

export interface AppointmentFollowUpInput {
  clinicId: string
  patientId: string
  appointmentId: string
  startTime: string
  endTime: string
  /** Defaults to now; injectable for tests. */
  nowIso?: string
}

/**
 * Schedule the five appointment-relative follow-ups for a freshly-booked
 * appointment. Best-effort: a queue failure for one type is logged and never
 * breaks the booking confirmation. Returns the types actually scheduled.
 */
export async function scheduleAppointmentFollowUps(input: AppointmentFollowUpInput): Promise<FollowUpType[]> {
  const now = input.nowIso ?? new Date().toISOString()
  const planned = computeAppointmentFollowUps(input.startTime, input.endTime, now)
  const scheduled: FollowUpType[] = []
  for (const p of planned) {
    try {
      await scheduleFollowUp(
        {
          clinicId: input.clinicId,
          patientId: input.patientId,
          appointmentId: input.appointmentId,
          type: p.type,
        },
        p.delayMs,
      )
      scheduled.push(p.type)
    } catch (e) {
      console.error(`[follow-up] failed to schedule ${p.type} for appointment ${input.appointmentId}`, e)
    }
  }
  return scheduled
}

export interface NoResponseFollowUpInput {
  clinicId: string
  patientId: string
  conversationId: string
  /** The patient's last-inbound time now; the job self-cancels if they reply after it. */
  silentSinceIso: string
  delayMs?: number
}

/**
 * Schedule a single no-response nudge for a conversation that is now awaiting the
 * patient. Best-effort. The worker self-cancels the nudge if the patient replies in
 * the meantime, and dedupes one nudge per conversation.
 */
export async function scheduleNoResponseFollowUp(input: NoResponseFollowUpInput): Promise<void> {
  try {
    await scheduleFollowUp(
      {
        clinicId: input.clinicId,
        patientId: input.patientId,
        conversationId: input.conversationId,
        type: FOLLOW_UP_TYPES.NO_RESPONSE,
        silentSinceIso: input.silentSinceIso,
      },
      input.delayMs ?? NO_RESPONSE_DELAY_MS,
    )
  } catch (e) {
    console.error(`[follow-up] failed to schedule no_response for conversation ${input.conversationId}`, e)
  }
}
