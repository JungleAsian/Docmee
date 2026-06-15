/**
 * The six-gate proactive model (architecture §9) — DETERMINISTIC, never LLM
 * discretion. Every proactive/automated message must clear all six gates, in order,
 * before it can be sent via an approved template. This is one of the two
 * safety-critical layers (the other is RLS); it is tested exhaustively in-phase.
 *
 * Gate order (first failure wins):
 *   1. opted out?            → skip
 *   2. automation enabled?   → skip if the clinic's automation/bot is off
 *   3. appointment cancelled? → skip (for appointment-linked automations)
 *   4. consent?              → skip if no consent on record
 *   5. already sent in 48h?  → skip (frequency cap / dedup)
 *   6. >24h window?          → require an approved template
 */
export type SixGate =
  | "opted_out"
  | "automation_disabled"
  | "appointment_cancelled"
  | "no_consent"
  | "frequency_cap"
  | "template_required";

export interface SixGateContext {
  optedOut: boolean;
  automationEnabled: boolean;
  /** Only meaningful for appointment-linked automations. */
  appointmentCancelled?: boolean;
  hasConsent: boolean;
  /** A message of this type already went out within the last 48h. */
  sentWithin48h: boolean;
  /** The 24h customer-service window is currently open. */
  within24hWindow: boolean;
  /** An approved Meta template exists for this message. */
  hasApprovedTemplate: boolean;
}

export interface SixGateResult {
  allowed: boolean;
  blockedBy?: SixGate;
}

export function evaluateSixGate(ctx: SixGateContext): SixGateResult {
  if (ctx.optedOut) return { allowed: false, blockedBy: "opted_out" };
  if (!ctx.automationEnabled) return { allowed: false, blockedBy: "automation_disabled" };
  if (ctx.appointmentCancelled) return { allowed: false, blockedBy: "appointment_cancelled" };
  if (!ctx.hasConsent) return { allowed: false, blockedBy: "no_consent" };
  if (ctx.sentWithin48h) return { allowed: false, blockedBy: "frequency_cap" };
  if (!ctx.within24hWindow && !ctx.hasApprovedTemplate) {
    return { allowed: false, blockedBy: "template_required" };
  }
  return { allowed: true };
}

/** The fixed automation catalog (architecture §9). */
export const AUTOMATION_CATALOG = [
  "booking_confirmation",
  "reminder_1day",
  "reminder_sameday",
  "post_consultation",
  "followup_7day",
  "checkin_3month",
  "review_request",
  "no_response",
  "abandoned_booking",
  "clinic_no_reply",
] as const;

export type AutomationType = (typeof AUTOMATION_CATALOG)[number];
