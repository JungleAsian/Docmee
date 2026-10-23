/** Sanitized diagnostics only; never a routing authorization or qualification record. */
export type LayaDiagnosticStatus = {
  clinicId: string
  checkedAt: string
  service: 'reachable' | 'unavailable'
  model: 'ready' | 'not_ready' | 'unknown'
  clinicOptIn: 'enabled' | 'disabled' | 'unknown'
  /** Effective rollout stage for menu routing: the lower of the global and clinic modes. */
  mode?: 'disabled' | 'shadow' | 'advisory' | 'live' | 'unknown'
  /** Server-owned record: unconfigured = responses rejected, unqualified = watch-only. */
  qualificationRecord?: 'unconfigured' | 'unqualified' | 'reviewed'
  qualification: 'unqualified' | 'reviewed'
  /** 'live' only when the record is reviewed AND the effective mode is live. */
  patientDecisions: 'blocked' | 'live'
  /** Typed-text capture for measuring LAYA (per-clinic opt-in). */
  capture?: 'enabled' | 'disabled' | 'unknown'
}

/** Aggregate counts only. No patient text is ever returned. */
export type LayaObservationSummary = {
  clinicId: string
  checkedAt: string
  capture: 'enabled' | 'disabled' | 'unknown'
  groups: Array<{
    task: 'workflow_branch' | 'administrative_intent'
    language: 'en' | 'es' | 'mixed' | 'unknown'
    total: number
    labeled: number
    answered: number
    /** Labelled by the very next tap AND LAYA returned a pick. */
    comparable: number
    agreed: number
  }>
  reasons: Array<{ reason: string; count: number }>
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
