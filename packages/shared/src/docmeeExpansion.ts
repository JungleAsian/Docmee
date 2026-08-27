/** Shared, dependency-free contracts used by API, workers, and InboxOS. */
export type AutomationMode = 'automated' | 'human_only'
export type PatientAutomationState = { automationMode?: unknown; optedOut?: unknown }

/** Human-only is an enforcement boundary; consent tags are deliberately ignored. */
export function isHumanOnly(value: PatientAutomationState | null | undefined): boolean {
  return value?.automationMode === 'human_only'
}

/** Guard immediately before any automated provider send or workflow resume. */
export function assertAutomationAllowed(value: PatientAutomationState | null | undefined): void {
  if (isHumanOnly(value)) throw new Error('automation_suppressed_human_only')
}

export type InboxLayoutSettings = { showContextRail: boolean; calendarExpanded: boolean; internalNotesVisible: boolean }
export type PatientChatVisibility = Record<'safetyHandoff' | 'lifecycleStatus' | 'tags' | 'aiAssistance' | 'assignee' | 'assignControls' | 'patientHistory' | 'chatStatus' | 'nextAppointment' | 'appointmentDateTime', boolean>

export const defaultInboxLayout: InboxLayoutSettings = { showContextRail: true, calendarExpanded: true, internalNotesVisible: true }
export const defaultPatientChatVisibility: PatientChatVisibility = {
  safetyHandoff: true, lifecycleStatus: true, tags: true, aiAssistance: true, assignee: true,
  assignControls: true, patientHistory: true, chatStatus: true, nextAppointment: true, appointmentDateTime: true,
}

/** Tolerant reader for clinic.settings, preserving safe defaults on bad data. */
export function readInboxSettings(settings: Record<string, unknown> | null | undefined) {
  const layout = typeof settings?.['inboxLayout'] === 'object' && settings['inboxLayout'] !== null ? settings['inboxLayout'] as Record<string, unknown> : {}
  const visibility = typeof settings?.['patientChatVisibility'] === 'object' && settings['patientChatVisibility'] !== null ? settings['patientChatVisibility'] as Record<string, unknown> : {}
  return {
    inboxLayout: {
      showContextRail: layout['showContextRail'] !== false,
      calendarExpanded: layout['calendarExpanded'] !== false,
      internalNotesVisible: layout['internalNotesVisible'] !== false,
    },
    patientChatVisibility: Object.fromEntries(Object.entries(defaultPatientChatVisibility).map(([key, fallback]) => [key, visibility[key] === undefined ? fallback : visibility[key] === true])) as PatientChatVisibility,
  }
}
