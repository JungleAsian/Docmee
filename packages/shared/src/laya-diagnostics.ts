/** Sanitized diagnostics only; never a routing authorization or qualification record. */
export type LayaDiagnosticStatus = {
  clinicId: string
  checkedAt: string
  service: 'reachable' | 'unavailable'
  model: 'ready' | 'not_ready' | 'unknown'
  clinicOptIn: 'enabled' | 'disabled' | 'unknown'
  qualification: 'unqualified'
  patientDecisions: 'blocked'
}

export type LayaDiagnosticTest = {
  clinicId: string
  checkedAt: string
  language: 'en' | 'es'
  durationMs: number
  outcome: 'response' | 'timeout' | 'unavailable' | 'invalid_response'
  qualification: 'unqualified'
  choice?: 'book' | 'hours' | null
  expectedChoice?: 'book'
  matchesExpected?: boolean
}
