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
  contradiction?: 'unknown' | 'clear' | 'conflict'
  autoApproveEnabled?: boolean
  privacySafe?: boolean
  sourcesCurrent?: boolean
}

export interface KbCandidateGateResult { eligible: boolean; autoApprove: boolean; reasons: string[] }

/** Deterministic publication gate; confidence never replaces grounding or safety. */
export function evaluateKbCandidateGates(input: KbCandidateGateInput): KbCandidateGateResult {
  const configured = input.groundingThreshold ?? 1
  const threshold = Number.isFinite(configured) && configured >= 0.8 && configured <= 1 ? configured : 1
  const reasons: string[] = []
  if (!validScore(input.confidence) || input.confidence < 0.8) reasons.push('confidence_below_80_percent')
  if (!validScore(input.groundingScore) || input.groundingScore < threshold) reasons.push('grounding_below_threshold')
  if (!input.medicalSafetyOk) reasons.push('medical_safety_failed')
  if (!input.promptSafetyOk) reasons.push('prompt_safety_failed')
  if (!input.contradictionFree || input.contradiction !== 'clear') reasons.push('contradiction_not_clear')
  if (input.patientFeedback === 'escalated') reasons.push('patient_escalated')
  if (input.patientFeedback === 'corrected') reasons.push('patient_corrected')
  if (input.privacySafe !== true) reasons.push('privacy_review_required')
  if (input.sourcesCurrent !== true) reasons.push('sources_not_current')
  const eligible = reasons.length === 0
  const restricted = Boolean(input.isMedical || input.isPolicyOrPricing)
  const repeated = Number.isInteger(input.consistencyCount) && input.consistencyCount >= 2
  if (restricted) reasons.push('staff_approval_required')
  if (!repeated) reasons.push('repeat_consistency_required')
  if (input.autoApproveEnabled !== true) reasons.push('automatic_publication_disabled')
  if (input.groundingScore !== 1) reasons.push('not_fully_grounded')
  return { eligible, autoApprove: eligible && input.groundingScore === 1 && repeated && !restricted && input.autoApproveEnabled === true, reasons }
}

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

export function deidentifyKbText(value: string): { text: string; changed: boolean } {
  const text = value.slice(0, 12000)
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email removed]')
    .replace(/(?:\+?\d[\d ()-]{6,}\d)/g, '[number removed]')
    .replace(/\b(?:my name is|me llamo|mi nombre es|patient name\s*:)\s+[^.!?\n]+/gi, '[name removed]')
    .replace(/https?:\/\/\S+/gi, '[link removed]')
  return { text, changed: text !== value }
}

export interface KbAnswerEvidence {
  answerConfidence: number | null
  groundingScore: number
  contradiction: 'unknown' | 'clear' | 'conflict'
  risks: string[]
  verifier: 'extractive-v1'
}

/** Deliberately conservative, not a semantic truth grader. Every factual claim
 * must be a complete sentence from current KB evidence. Paraphrases need review.
 * Multiple distinct evidence texts remain unknown: absence of detected conflict
 * must never be reported as proof that no conflicting clinic policy exists. */
export function assessKbAnswer(question: string, answer: string, sources: string[], confidence?: number): KbAnswerEvidence {
  const normalize = (s: string) => s.toLocaleLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
  const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map(normalize).filter(Boolean)
  const sourceSentences = new Set(sources.flatMap(sentences))
  const claims = sentences(answer)
  const grounded = claims.filter((claim) => sourceSentences.has(claim)).length
  const groundingScore = claims.length ? grounded / claims.length : 0
  const text = normalize(`${question} ${answer}`).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const risks: string[] = []
  if (/\b(acne|dolor|pain|symptom\w*|sintoma\w*|diagnos\w*|medic\w*|treat\w*|tratamiento\w*|dose\w*|dosis|prescri\w*|pregnan\w*|embaraz\w*)\b/.test(text)) risks.push('medical')
  if (/\b(price\w*|cost\w*|precio\w*|costo\w*|policy|polici\w*|politica\w*|refund\w*|reembolso\w*|insurance|seguro\w*|cancel\w*|deposit\w*|fee\w*)\b/.test(text)) risks.push('pricing_or_policy')
  if (/ignore.{0,40}(?:instruction|previous)|(?:system|developer)\s+prompt|ignora.{0,40}instruccion|reveal.{0,40}(?:prompt|secret)|<\/?(?:system|script)/i.test(text)) risks.push('prompt_injection')
  if (deidentifyKbText(question).changed || deidentifyKbText(answer).changed) risks.push('privacy')
  return { answerConfidence: validScore(confidence) ? confidence : null, groundingScore,
    contradiction: groundingScore === 1 && new Set(sources.map(normalize)).size === 1 ? 'clear' : 'unknown',
    risks, verifier: 'extractive-v1' }
}

export function deriveKbEvidenceScore(scores: Array<number | null | undefined>): number {
  return Math.max(0, Math.min(1, scores.reduce<number>((best, score) => {
    const numeric = typeof score === 'number' && Number.isFinite(score) ? score : 0
    return Math.max(best, numeric)
  }, 0)))
}
