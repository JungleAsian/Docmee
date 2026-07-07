import type { Intent } from '@docmee/llm'

export type AgentRoute =
  | { agent: 'botbase' }
  | { agent: 'calbot'; action: 'book' | 'reschedule' | 'cancel' | 'status' }
  | { agent: 'alertflow'; reason: 'emergency' | 'human_handoff' }
  | { agent: 'silence'; reason: 'opted_out' | 'outside_hours' }

export interface RouteContext {
  isInsideBusinessHours: boolean
  patientOptedOut: boolean
}

export function routeIntent(intent: Intent, context: RouteContext): AgentRoute {
  // Opted-out patients are never replied to (Decision: STOP is absolute).
  if (context.patientOptedOut) return { agent: 'silence', reason: 'opted_out' }

  // Outside business hours → stay silent, but still honour explicit opt-out (Decision 1).
  if (!context.isInsideBusinessHours && intent !== 'stop_optout') {
    return { agent: 'silence', reason: 'outside_hours' }
  }

  switch (intent) {
    case 'emergency':
      return { agent: 'alertflow', reason: 'emergency' }
    case 'human_handoff_request':
      return { agent: 'alertflow', reason: 'human_handoff' }
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
