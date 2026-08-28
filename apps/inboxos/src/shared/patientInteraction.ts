export type InteractionMode = 'active' | 'opted_out'

export function interactionMode(metadata: Record<string, unknown> | null | undefined): InteractionMode {
  return metadata?.['staffOptedOut'] === true ? 'opted_out' : 'active'
}

export function staffOptOutRequest(patientId: string, mode: InteractionMode) {
  return {
    path: `/patients/${patientId}/staff-opt-out`,
    body: { optedOut: mode === 'opted_out' },
  }
}
