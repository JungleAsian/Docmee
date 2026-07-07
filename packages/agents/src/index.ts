import type { AgentRoute } from './router.js'

export type { AgentRoute, RouteContext } from './router.js'
export { routeIntent } from './router.js'

export type { HandoffStatus } from './handoff.js'
export {
  isBotPaused,
  detectHumanRequest,
  handoffNotice,
  BOT_PAUSED_AT,
  HANDOFF_REASON,
} from './handoff.js'

export { isOptOutMessage, isOptInMessage, optInConfirmation } from './consent.js'

export * from './botbase/index.js'

export * from './assistant/index.js'

export interface MessageContext {
  clinicId: string
  conversationId: string
  patientPhone: string
  message: string
  history: Array<{ role: 'user' | 'assistant'; content: string }>
}

export interface AgentResult {
  route: AgentRoute
  response: string
  requiresHandoff: boolean
  appointmentData?: AppointmentData
}

export interface AppointmentData {
  date: string
  time: string
  doctorId: string
  patientName?: string
}

export interface CalendarClient {
  listSlots(doctorId: string, date: string): Promise<string[]>
  bookAppointment(data: AppointmentData): Promise<string>
  cancelAppointment(appointmentId: string): Promise<void>
  rescheduleAppointment(appointmentId: string, newData: AppointmentData): Promise<string>
}

export * from './calbot/index.js'

export * from './sheets/index.js'

export * from './workflows/index.js'

export async function routeMessage(_context: MessageContext): Promise<AgentResult> {
  throw new Error('routeMessage: not implemented — wire LLM router in P05+')
}
