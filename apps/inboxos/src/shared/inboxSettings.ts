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
  | 'appointmentDateTime'
  | 'inactiveChannels'
  | 'headerNextAppointment'
  | 'headerPatientHistory'
  | 'headerStatusSelector'
  | 'headerResolveAction',
  boolean
>

const visibilityKeys = [
  'safetyHandoff', 'lifecycleStatus', 'tags', 'aiAssistance', 'assignee',
  'assignControls', 'patientHistory', 'chatStatus', 'nextAppointment',
  'appointmentDateTime', 'inactiveChannels', 'headerNextAppointment',
  'headerPatientHistory', 'headerStatusSelector', 'headerResolveAction',
] as const

const visibilityDefaults: PatientChatVisibility = {
  safetyHandoff: true,
  lifecycleStatus: true,
  tags: true,
  aiAssistance: true,
  assignee: true,
  assignControls: true,
  patientHistory: true,
  chatStatus: true,
  nextAppointment: true,
  appointmentDateTime: true,
  inactiveChannels: false,
  headerNextAppointment: true,
  headerPatientHistory: true,
  headerStatusSelector: true,
  headerResolveAction: true,
}

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
      visibilityKeys.map((key) => [key, visibility[key] === undefined ? visibilityDefaults[key] : visibility[key] === true]),
    ) as PatientChatVisibility,
  }
}
