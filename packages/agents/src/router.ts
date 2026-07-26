import type { Intent } from '@docmee/llm'

export type AgentRoute =
  | { agent: 'botbase' }
  | { agent: 'calbot'; action: 'book' | 'reschedule' | 'cancel' | 'status' }
  | { agent: 'alertflow'; reason: 'emergency' | 'human_handoff' }
  | { agent: 'silence'; reason: 'opted_out' | 'outside_hours' }

export type ConversationWorkflow = 'booking' | 'human_handoff' | 'inquiry'

export type OrchestrationDecision =
  | {
      workflow: 'booking'
      route: Extract<AgentRoute, { agent: 'calbot' }>
    }
  | {
      workflow: 'human_handoff'
      route: Extract<AgentRoute, { agent: 'alertflow' }>
    }
  | {
      workflow: 'inquiry'
      route: Extract<AgentRoute, { agent: 'botbase' }>
    }
  | {
      // Consent and business-hours policy can suppress automation before one of
      // the three conversation workflows is allowed to run.
      workflow: null
      route: Extract<AgentRoute, { agent: 'silence' }>
    }

export interface RouteContext {
  isInsideBusinessHours: boolean
  patientOptedOut: boolean
}

export function routeIntent(intent: Intent, context: RouteContext): AgentRoute {
  // Opted-out patients are never replied to (Decision: STOP is absolute).
  if (context.patientOptedOut) return { agent: 'silence', reason: 'opted_out' }

  // Safety and a patient's request for a person outrank business-hours policy.
  // High-precision keyword guards run before classification in the worker; these
  // branches give AI-only detections the same always-on escalation behavior.
  if (intent === 'emergency') return { agent: 'alertflow', reason: 'emergency' }
  if (intent === 'human_handoff_request') {
    return { agent: 'alertflow', reason: 'human_handoff' }
  }

  // Outside business hours → stay silent, but still honour explicit opt-out (Decision 1).
  if (!context.isInsideBusinessHours && intent !== 'stop_optout') {
    return { agent: 'silence', reason: 'outside_hours' }
  }

  switch (intent) {
    case 'booking_request':
      return { agent: 'calbot', action: 'book' }
    case 'reschedule_request':
      return { agent: 'calbot', action: 'reschedule' }
    case 'cancel_request':
      return { agent: 'calbot', action: 'cancel' }
    case 'appointment_status_check':
      return { agent: 'calbot', action: 'status' }
    case 'stop_optout':
      return { agent: 'silence', reason: 'opted_out' }
    default:
      return { agent: 'botbase' }
  }
}

/**
 * Convert the bounded AI intent into one of the three patient-facing workflows.
 *
 * The classifier supplies semantic judgment; this function remains deterministic
 * so booking continuity, human escalation, and inquiry handling are independently
 * testable. Consent and outside-hours policy remain an explicit pre-workflow gate.
 */
export function orchestrateConversation(
  intent: Intent,
  context: RouteContext,
): OrchestrationDecision {
  const route = routeIntent(intent, context)

  switch (route.agent) {
    case 'calbot':
      return { workflow: 'booking', route }
    case 'alertflow':
      return { workflow: 'human_handoff', route }
    case 'botbase':
      return { workflow: 'inquiry', route }
    case 'silence':
      return { workflow: null, route }
  }
}
