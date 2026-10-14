type SelectableDoctor = { id: string; isActive: boolean }

/** Never carry a selection across clinic rosters or select an inactive doctor. */
export function defaultDoctorId(doctors: readonly SelectableDoctor[], selected?: string): string {
  const active = doctors.filter((doctor) => doctor.isActive)
  if (selected && active.some((doctor) => doctor.id === selected)) return selected
  return active.length === 1 ? active[0].id : ''
}

export function bookingScopeKey(clinicId: string | null, conversationId: string, doctors: readonly SelectableDoctor[]): string {
  return JSON.stringify([clinicId, conversationId, doctors.filter((doctor) => doctor.isActive).map((doctor) => doctor.id).sort()])
}
