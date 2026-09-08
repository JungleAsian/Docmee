export type PatientKbFeedback = 'accepted' | 'corrected' | 'escalated' | 'unknown'

export interface KbCandidateGateInput {
  confidence: number
  groundingScore: number
  groundingThreshold?: number
  medicalSafetyOk: boolean
  promptSafetyOk: boolean
  contradictionFree: boolean
  consistencyCount: number
  patientFeedback?: PatientKbFeedback
  humanApproved?: boolean
  isMedical?: boolean
  isPolicyOrPricing?: boolean
}

export interface KbCandidateGateResult { eligible: boolean; autoApprove: boolean; reasons: string[] }

/** Deterministic publication gate; confidence never replaces grounding or safety. */
export function evaluateKbCandidateGates(input: KbCandidateGateInput): KbCandidateGateResult {
  const threshold = input.groundingThreshold ?? 0.78
  const reasons: string[] = []
  if (input.confidence < 0.8) reasons.push('confidence_below_80_percent')
  if (input.groundingScore < threshold) reasons.push('grounding_below_threshold')
  if (!input.medicalSafetyOk) reasons.push('medical_safety_failed')
  if (!input.promptSafetyOk) reasons.push('prompt_safety_failed')
  if (!input.contradictionFree) reasons.push('contradiction_detected')
  if (input.patientFeedback === 'escalated') reasons.push('patient_escalated')
  const eligible = reasons.length === 0
  const restricted = Boolean(input.isMedical || input.isPolicyOrPricing)
  const autoApprove = eligible && input.consistencyCount >= 2 && !restricted
  if (eligible && restricted && !input.humanApproved) reasons.push('staff_approval_required')
  if (eligible && input.consistencyCount < 2) reasons.push('repeat_consistency_required')
  return { eligible, autoApprove: autoApprove || (eligible && restricted && input.humanApproved === true), reasons }
}

export function deriveKbEvidenceScore(scores: Array<number | null | undefined>): number {
  return Math.max(0, Math.min(1, scores.reduce<number>((best, score) => {
    const numeric = typeof score === 'number' && Number.isFinite(score) ? score : 0
    return Math.max(best, numeric)
  }, 0)))
}
