// Req 20 — patient-safety triage. The workers auto-apply a handful of tags that a
// secretary must never miss: a possible medical emergency, a generic safety flag,
// an explicitly urgent thread, or an upset patient. Everywhere a conversation is
// shown (the list rows, the open conversation's banner) we collapse its tag set
// into a single severity so the most consequential state is visually unmistakable
// — not buried as one chip among many in the tag panel.
//
// `critical` (red) = a possible emergency / medical-safety flag → needs a human now.
// `warning`  (amber) = urgent or an upset patient → triage ahead of the queue.

export type SafetyLevel = 'critical' | 'warning'

// Tag names mirror @docmee/inboxos tagTypes.ts (and the worker-applied flags).
const CRITICAL_TAGS = ['emergency', 'medical_safety'] as const
const WARNING_TAGS = ['urgent', 'patient_upset'] as const

export interface SafetyAssessment {
  /** The highest severity present, or null when no safety tag is set. */
  level: SafetyLevel | null
  /** The safety tag names that contributed, in severity order (critical first). */
  tags: string[]
}

/**
 * Classify a conversation's tag names into a single safety severity. Critical
 * outranks warning; unrelated tags (billing, appointment, …) are ignored.
 */
export function assessSafety(tagNames: readonly string[] | undefined | null): SafetyAssessment {
  if (!tagNames || tagNames.length === 0) return { level: null, tags: [] }
  const set = new Set(tagNames)
  const critical = CRITICAL_TAGS.filter((t) => set.has(t))
  const warning = WARNING_TAGS.filter((t) => set.has(t))
  if (critical.length > 0) return { level: 'critical', tags: [...critical, ...warning] }
  if (warning.length > 0) return { level: 'warning', tags: warning }
  return { level: null, tags: [] }
}

/** Numeric rank for stable triage sorting — higher floats to the top. */
export function safetyRank(level: SafetyLevel | null): number {
  if (level === 'critical') return 2
  if (level === 'warning') return 1
  return 0
}
