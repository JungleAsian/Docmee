import { createLayaAdapter, type LayaCandidate, type LayaInput, type LayaAssessment } from './adapter.js'

export const administrativeIntentCandidates: readonly Readonly<LayaCandidate>[] = Object.freeze([
  { id: 'booking', label: 'Request a new appointment / Solicitar una nueva cita' },
  { id: 'reschedule', label: 'Move an existing appointment / Reprogramar una cita existente' },
  { id: 'cancel', label: 'Cancel an existing appointment / Cancelar una cita existente' },
  { id: 'clinic_information', label: 'Ask for clinic information / Consultar información de la clínica' },
  { id: 'secretary', label: 'Ask for a human secretary / Solicitar atención de secretaría' },
  { id: 'unclear', label: 'Ambiguous or insufficient information / Información ambigua o insuficiente' },
  { id: 'unsupported', label: 'Outside supported administrative requests / Fuera de las solicitudes administrativas admitidas' },
].map(candidate => Object.freeze(candidate)))

/** Classification only. The caller must still apply permissions and action safeguards. */
export async function assessAdministrativeIntent(
  adapter: ReturnType<typeof createLayaAdapter>,
  input: Pick<LayaInput, 'clinicId' | 'text' | 'language' | 'priority'>,
): Promise<LayaAssessment> {
  const result = await adapter.assess({ ...input, task: 'administrative_intent',
    candidates: administrativeIntentCandidates.map(candidate => ({ ...candidate })) })
  if (result.choiceId === 'unclear' || result.choiceId === 'unsupported') {
    return { outcome: 'fallback', reason: 'uncertain', mode: result.mode, apply: false, rawScore: result.rawScore }
  }
  return result
}
