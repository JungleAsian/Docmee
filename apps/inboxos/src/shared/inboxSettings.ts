export type PatientChatVisibility = Record<
  | 'safetyHandoff'
  | 'lifecycleStatus'
  | 'tags'
  | 'aiAssistance'
  | 'assignee'
  | 'assignControls'
  | 'patientHistory'
  | 'chatStatus'
  | 'nextAppointment'
  | 'appointmentDateTime',
  boolean
>

const visibilityKeys = [
  'safetyHandoff', 'lifecycleStatus', 'tags', 'aiAssistance', 'assignee',
  'assignControls', 'patientHistory', 'chatStatus', 'nextAppointment',
  'appointmentDateTime',
] as const

/** Tolerant staged-rollout reader for clinic Inbox preferences. */
export function readInboxSettings(settings: Record<string, unknown> | null | undefined) {
  const layout = (settings?.inboxLayout && typeof settings.inboxLayout === 'object'
    ? settings.inboxLayout
    : {}) as Record<string, unknown>
  const visibility = (settings?.patientChatVisibility && typeof settings.patientChatVisibility === 'object'
    ? settings.patientChatVisibility
    : {}) as Record<string, unknown>
  return {
    inboxLayout: {
      showContextRail: layout.showContextRail !== false,
      calendarExpanded: layout.calendarExpanded !== false,
      internalNotesVisible: layout.internalNotesVisible !== false,
    },
    patientChatVisibility: Object.fromEntries(
      visibilityKeys.map((key) => [key, visibility[key] === undefined ? true : visibility[key] === true]),
    ) as PatientChatVisibility,
  }
}
