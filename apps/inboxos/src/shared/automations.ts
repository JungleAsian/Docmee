// Screen 12 (Automation & follow-ups) — pure product facts + per-clinic config
// reads for the automation builder. The runtime that actually sends these lives in
// the workers (apps/workers/src/follow-up.ts + review-request.worker.ts); the offset
// and 24h-window facts below mirror that worker so the panel can render a faithful
// schedule preview + Meta-compliance warning without importing the worker package.
//
// Keep this module pure (no Date.now, no I/O) so it stays trivially testable.

// The follow-up types the builder exposes as scheduled automations (Req 14). The
// worker also knows `review_request` (its own section here) and treats `no_response`
// as a mid-conversation nudge — both surfaced below.
export type FollowUpType =
  | 'appointment_confirmation'
  | 'appointment_reminder'
  | 'post_consultation'
  | 'seven_day'
  | 'three_month'
  | 'no_response'

/** Where the schedule offset is measured from. */
export type ScheduleAnchor = 'appointment' | 'silence'

export interface ScheduleOffset {
  amount: number
  unit: 'hour' | 'day'
  direction: 'before' | 'after'
  anchor: ScheduleAnchor
}

/**
 * 24-hour customer-care window behaviour (Req 19 Meta Compliance):
 *  - `template_fallback`: free text inside the window, or the clinic's approved HSM
 *    template outside it → can always reach the patient.
 *  - `in_window_only`: no template category applies, so a proactive send is skipped
 *    when the patient is outside the 24h window. Mirrors templateCategoryForType().
 */
export type WindowRule = 'template_fallback' | 'in_window_only'

export interface AutomationDef {
  type: FollowUpType
  offset: ScheduleOffset
  window: WindowRule
}

// Ordered as they fire across an appointment's lifecycle.
export const AUTOMATION_DEFS: AutomationDef[] = [
  {
    type: 'appointment_confirmation',
    offset: { amount: 24, unit: 'hour', direction: 'before', anchor: 'appointment' },
    window: 'template_fallback',
  },
  {
    type: 'appointment_reminder',
    offset: { amount: 3, unit: 'hour', direction: 'before', anchor: 'appointment' },
    window: 'template_fallback',
  },
  {
    type: 'post_consultation',
    offset: { amount: 2, unit: 'hour', direction: 'after', anchor: 'appointment' },
    window: 'in_window_only',
  },
  {
    type: 'seven_day',
    offset: { amount: 7, unit: 'day', direction: 'after', anchor: 'appointment' },
    window: 'in_window_only',
  },
  {
    type: 'three_month',
    offset: { amount: 90, unit: 'day', direction: 'after', anchor: 'appointment' },
    window: 'in_window_only',
  },
  {
    type: 'no_response',
    offset: { amount: 20, unit: 'hour', direction: 'after', anchor: 'silence' },
    window: 'in_window_only',
  },
]

/** The review-request trigger window (Gap #37): 48h–7d after a completed appointment. */
export const REVIEW_TRIGGER = { fromHours: 48, toDays: 7 } as const

/** Outbound anti-spam cap surfaced to the admin (Req 19) — mirrors the worker default. */
export const PROACTIVE_CAP_PER_DAY = 5

// ── Per-clinic config (persisted under clinic.settings.automations) ──────────────

export interface AutomationsConfig {
  /** Per-type enable flag. Absent/true = enabled (backward-compatible default-on). */
  followUps?: Partial<Record<FollowUpType, boolean>>
  /** Rev 2 Approval node: per-type "require secretary sign-off before send". Default OFF. */
  requireApproval?: Partial<Record<FollowUpType, boolean>>
  reviewRequest?: { enabled?: boolean }
}

/** Read the automations blob off a clinic.settings object (never throws). */
export function readAutomations(settings: { automations?: unknown } | null | undefined): AutomationsConfig {
  const a = settings?.automations
  return a && typeof a === 'object' ? (a as AutomationsConfig) : {}
}

/** Is a follow-up type enabled? Defaults to ON when the clinic has no explicit flag. */
export function isFollowUpEnabled(config: AutomationsConfig, type: FollowUpType): boolean {
  return config.followUps?.[type] !== false
}

/** Is review-request automation enabled? Defaults to ON. */
export function isReviewEnabled(config: AutomationsConfig): boolean {
  return config.reviewRequest?.enabled !== false
}

/** Does a follow-up type require secretary sign-off before sending? Defaults to OFF. */
export function requiresApproval(config: AutomationsConfig, type: FollowUpType): boolean {
  return config.requireApproval?.[type] === true
}

/** How many follow-up automations are currently active, of the total modelled. */
export function activeCount(config: AutomationsConfig): { active: number; total: number } {
  const total = AUTOMATION_DEFS.length
  const active = AUTOMATION_DEFS.filter((d) => isFollowUpEnabled(config, d.type)).length
  return { active, total }
}
