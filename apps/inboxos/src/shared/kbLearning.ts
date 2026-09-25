import type { AuthUser } from './types'

export type CandidateStatus = 'pending_review' | 'approved' | 'rejected' | 'superseded'
export const rejectionReasons = ['unsupported', 'outdated', 'unsafe', 'duplicate', 'not_clinic_policy', 'other'] as const
export type RejectionReason = typeof rejectionReasons[number]
export interface ReviewReadiness {
  citationsCurrent: boolean; confidenceAtLeast80: boolean; groundingMeetsThreshold: boolean
  safetyClear: boolean; scopeClear: boolean; feedbackClear: boolean; unexpired: boolean
  ready: boolean; reasons: string[]
}
export interface LearningCitation {
  chunkId: string; documentId: string; documentVersion: number
  retrievalRevision?: number; doctorId?: string | null; language?: string | null; governanceReviewState?: string
}
export interface LearningEvidence {
  relevance: number | null; confidence: number | null; grounding: number | null
  contradiction: 'unknown' | 'clear' | 'conflict'; risks: string[]
  safeContentClass?: string; retrievalRevision?: number; doctorId?: string | null; language?: string | null
}
export interface LearningCandidate {
  id: string; clinicId: string; revision: number; status: CandidateStatus
  sourceQuestion: string; candidateContent: string; confidenceScore: number; groundingScore: number
  medicalSafetyOk: boolean; promptSafetyOk: boolean; contradictionFree: boolean
  consistencyCount: number; patientFeedback: string; humanEdit: string | null; staffConfirmed: boolean
  supportingChunks: LearningCitation[]; evidence: LearningEvidence; expiresAt: string | null
  publishedDocumentId: string | null; publishedDocumentVersion: number | null
  approvedBy: string | null; approvedAt: string | null; previousVersionId: string | null
  gateReasons?: string[]; reviewReadiness?: ReviewReadiness; automaticApprovalEligible?: boolean; automaticApprovalReasons?: string[]; updatedAt: string
}
export interface LearningSettings { autoApprove: boolean; groundingThreshold: number; evidenceRetentionHours: number }
export interface LearningEvent {
  id: string; candidateId: string | null; question: string; answer: string; citations: LearningCitation[]
  evidence: LearningEvidence; feedback: string; handoffReason: string | null; createdAt: string
}
export interface LearningGap { id: string; question: string; reason: string; occurrences: number; status: string; expiresAt: string }
export interface LearningHistory {
  id: string; candidateId: string; revision: number; action: string; actorId: string | null
  content: string; citations: LearningCitation[]; documentId: string | null; documentVersion: number | null; rejectionReason: RejectionReason | null; rejectionDetail: string | null; createdAt: string
}
export interface ReviewCommand {
  clinicId: string; candidateId: string; action: 'edit' | 'reject' | 'approve' | 'rollback'
  expectedRevision: number; content?: string; staffConfirmed?: boolean; historyId?: string; rejectionReason?: RejectionReason; rejectionDetail?: string
}
export interface ReviewResult { candidate: LearningCandidate; indexing: 'queued' | 'failed' | 'unchanged' }

export function canTeachAgent(user: Pick<AuthUser, 'role'> | null | undefined): boolean {
  return user?.role === 'ia_studio_admin'
}

export function canReviewLearning(user: Pick<AuthUser, 'role' | 'clinicId' | 'clinicIds'> | null | undefined, clinicId: string): boolean {
  if (!user || !clinicId) return false
  return user.role === 'ia_studio_admin'
    || (user.role === 'clinic_admin' && [user.clinicId, ...(user.clinicIds ?? [])].includes(clinicId))
}
export function scorePercent(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? `${Math.round(value * 100)}%` : null
}
export function candidateNeedsRevalidation(candidate: LearningCandidate, content: string): boolean {
  return content !== (candidate.humanEdit ?? candidate.candidateContent)
    || (candidate.status === 'pending_review' && candidate.humanEdit !== null && candidate.humanEdit !== undefined)
}
export function matchesLearningSearch(query: string, ...text: (string | null | undefined)[]): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  return !normalized || text.some(value => value?.toLocaleLowerCase().includes(normalized))
}
export function reviewUnavailable(candidate: LearningCandidate, now = Date.now()): boolean {
  if (candidate.status === 'pending_review' && !candidate.expiresAt) return true
  return Boolean(candidate.expiresAt && (!Number.isFinite(Date.parse(candidate.expiresAt)) || Date.parse(candidate.expiresAt) <= now))
}
export function rollbackSnapshots(candidate: LearningCandidate, history: LearningHistory[]): LearningHistory[] {
  if (candidate.status !== 'approved' || !candidate.publishedDocumentId) return []
  return history.slice(0, 100).filter(row => row.candidateId === candidate.id
    && ['approve', 'rollback'].includes(row.action) && row.documentId === candidate.publishedDocumentId
    && Number.isInteger(row.documentVersion) && Number(row.documentVersion) >= 1
    && Number(row.documentVersion) <= Number(candidate.publishedDocumentVersion))
}
export function reviewCommand(clinicId: string, candidate: LearningCandidate, action: ReviewCommand['action'], content: string, confirmed: boolean, options: { historyId?: string; rejectionReason?: RejectionReason; rejectionDetail?: string } = {}): ReviewCommand {
  if (candidate.clinicId !== clinicId || reviewUnavailable(candidate) || !['pending_review', 'approved'].includes(candidate.status)) throw new Error('refresh_review')
  if ((action === 'rollback' && candidate.status !== 'approved') || (['approve', 'reject'].includes(action) && candidate.status !== 'pending_review')) throw new Error('refresh_review')
  if (['approve', 'rollback'].includes(action) && !confirmed) throw new Error('confirmation_required')
  if (action === 'rollback' && !options.historyId) throw new Error('confirmation_required')
  if (action === 'reject' && !options.rejectionReason) throw new Error('rejection_reason_required')
  if (action === 'reject' && options.rejectionReason === 'other' && !options.rejectionDetail?.trim()) throw new Error('rejection_detail_required')
  return { clinicId, candidateId: candidate.id, expectedRevision: candidate.revision, action,
    ...(['edit', 'approve'].includes(action) ? { content: content.trim(), staffConfirmed: confirmed } : {}),
    ...(action === 'rollback' ? { historyId: options.historyId, staffConfirmed: true } : {}),
    ...(action === 'reject' ? { rejectionReason: options.rejectionReason, ...(options.rejectionDetail?.trim() ? { rejectionDetail: options.rejectionDetail.trim() } : {}) } : {}) }
}

// Local, typed EN/ES copy for this bounded review workspace. Raw server reason
// codes remain visible as diagnostic evidence, not translated safety decisions.
export const learningCopy = {
  en: {
    title: 'Governed KB learning', intro: 'Answers do not train model weights. Only reviewed, current clinic knowledge becomes a retrievable source.',
    historicalEvidence: 'Historical evidence for the original generated answer — not validation of edited text',
    historicalCitations: 'Historical citations — independently verify support for the edited text',
    revalidation: 'Edited text requires renewed validation. Original confidence, grounding and contradiction checks do not validate this draft. Staff must independently review the exact text before publication.',
    currentValidation: 'Current candidate validation record', search: 'Search loaded questions and answers', searchHint: 'Searches only the bounded records loaded in this view, not all patient history.',
    policy: 'Automatic publication is off by default. When enabled, only narrowly verified office-opening facts qualify: at least 80% confidence, full grounding, repeated consistency, current sources, and every safety gate. Medical guidance, pricing, policy, conflict, corrections and unknown content require staff review.',
    candidates: 'Candidates', events: 'Answer feedback', gaps: 'Knowledge gaps', settings: 'Learning settings', refresh: 'Refresh', loading: 'Loading…', empty: 'No records in this view.',
    bounded: 'Most recent 50 candidates / 100 feedback events and gaps. Expired evidence is excluded. This is not the complete conversation history.',
    pending_review: 'Pending review', approved: 'Approved', rejected: 'Rejected', superseded: 'Superseded',
    inspect: 'Inspect', close: 'Close review', question: 'Patient question (temporary evidence)', content: 'Generalized clinic fact to publish — remove patient-specific details',
    relevance: 'Retrieval relevance', confidence: 'Answer confidence', grounding: 'Grounding', contradiction: 'Contradiction check', risks: 'Safety risk flags', unknown: 'Unknown / not measured',
    medical: 'Medical safety', prompt: 'Prompt-injection safety', passed: 'Passed recorded check', notPassed: 'Not established', feedback: 'Patient feedback', consistency: 'Consistent observations',
    citations: 'Supporting citations', noCitations: 'No KB citations. Staff must independently verify this correction.', version: 'Version', scope: 'Doctor / language scope',
    confirmation: 'I reviewed the current evidence and confirm publication of this exact clinic fact. I resolved conflicts and removed private patient information.',
    staffReadiness: 'Reviewer readiness checklist', readyForStaffApproval: 'Ready for staff approval', notReadyForStaffApproval: 'Needs staff review', staffReadinessHint: 'This checklist describes the current evidence. It is separate from the narrower automatic-publication eligibility below.',
    readinessCitations: 'Citations are current', readinessConfidence: 'Confidence is at least 80%', readinessGrounding: 'Grounding meets the configured threshold', readinessSafety: 'Safety and risk checks are clear', readinessScope: 'Doctor and language scope is clear', readinessFeedback: 'No correction or escalation feedback', readinessExpiry: 'Evidence has not expired', readinessReasons: 'Staff-readiness issues',
    eligibleForAutomaticApproval: 'Eligible for automatic approval', notEligibleForAutomaticApproval: 'Not eligible for automatic approval', automaticEligibilityHint: 'Automatic approval remains limited to fully grounded, safe, repeated office-hours facts. It never replaces staff review requirements.', automaticReasons: 'Automatic-approval blockers',
    rejectionReason: 'Rejection reason', rejectionDetail: 'Explain the other reason', rejection_unsupported: 'Unsupported by current clinic knowledge', rejection_outdated: 'Outdated information', rejection_unsafe: 'Unsafe or sensitive claim', rejection_duplicate: 'Duplicate of existing clinic knowledge', rejection_not_clinic_policy: 'Not clinic policy', rejection_other: 'Other (explanation required)',
    edit: 'Save review draft', approve: 'Approve and publish', reject: 'Reject candidate', history: 'This candidate’s history', historyLimit: 'Only this candidate’s returned history is shown; ancestor history is not loaded.',
    rollback: 'Restore this approved snapshot', rollbackConfirm: 'I reviewed this historical content and its citations and want to republish it as a new version.',
    auto: 'Enable guarded automatic publication', threshold: 'Configured grounding threshold (80–100%)', retention: 'Temporary evidence retention (1–24 hours)', save: 'Save settings',
    thresholdHint: 'Automatic publication still requires 100% grounding; lowering this setting does not relax that gate.',
    accepted: 'Accepted', corrected: 'Corrected', escalated: 'Escalated', recordFeedback: 'Record observed feedback', feedbackHint: 'Record only patient feedback actually observed. Silence is not acceptance.',
    correction: 'Create staff correction draft', resolve: 'Mark gap resolved', correctionConfirm: 'I independently verified this generalized clinic fact. It contains no patient-specific or private details.',
    error: 'Request failed. Refresh and review the current data before trying again.', conflict: 'This record or its sources changed, expired, or cannot be reviewed. Data has been refreshed. Reopen the current record and review again; no action was retried.',
    saved: 'Saved. Review the updated record before the next action.', published: 'Publication committed. Vector indexing is queued; this is not confirmation that indexing finished.', indexFailed: 'Publication committed, but vector indexing failed. Current approved content may remain available to lexical search. Use Re-index to repair indexing.',
    expiry: 'Evidence expires', approver: 'Approver / approval time', publication: 'Published document / version', reasons: 'Automatic publication blockers', notAuthed: 'Only authorized clinic administrators and Admin Studio administrators can review this clinic.',
    lexical: 'Available to lexical retrieval', unavailable: 'Not confirmed as currently retrievable', vector: 'Vector indexing', source: 'Source', failed: 'Failed', withdrawn: 'Withdrawn', governed: 'Governed learning', unknownSource: 'Other / unverified source',
  },
  es: {
    title: 'Aprendizaje supervisado de la KB', intro: 'Las respuestas no entrenan los pesos del modelo. Solo el conocimiento vigente y revisado de la clínica se convierte en fuente recuperable.',
    historicalEvidence: 'Evidencia histórica de la respuesta generada original — no valida el texto editado',
    historicalCitations: 'Citas históricas — verifique de forma independiente el respaldo del texto editado',
    revalidation: 'El texto editado requiere nueva validación. La confianza, el respaldo y el control de contradicciones originales no validan este borrador. El personal debe revisar de forma independiente el texto exacto antes de publicarlo.',
    currentValidation: 'Registro de validación del candidato actual', search: 'Buscar en preguntas y respuestas cargadas', searchHint: 'Solo busca en los registros limitados cargados en esta vista, no en todo el historial de pacientes.',
    policy: 'La publicación automática está desactivada por defecto. Al activarla, solo califican datos de apertura verificados: confianza mínima del 80%, respaldo completo, consistencia repetida, fuentes vigentes y todos los controles de seguridad. Orientación médica, precios, políticas, conflictos, correcciones y contenido desconocido requieren revisión del personal.',
    candidates: 'Candidatos', events: 'Comentarios sobre respuestas', gaps: 'Vacíos de conocimiento', settings: 'Ajustes del aprendizaje', refresh: 'Actualizar', loading: 'Cargando…', empty: 'No hay registros en esta vista.',
    bounded: 'Últimos 50 candidatos / 100 comentarios y vacíos. Se excluye evidencia vencida. No es el historial completo de conversaciones.',
    pending_review: 'Pendiente de revisión', approved: 'Aprobado', rejected: 'Rechazado', superseded: 'Reemplazado',
    inspect: 'Revisar', close: 'Cerrar revisión', question: 'Pregunta del paciente (evidencia temporal)', content: 'Dato general de la clínica para publicar — quite detalles personales del paciente',
    relevance: 'Relevancia de recuperación', confidence: 'Confianza de la respuesta', grounding: 'Respaldo en fuentes', contradiction: 'Control de contradicciones', risks: 'Alertas de seguridad', unknown: 'Desconocido / no medido',
    medical: 'Seguridad médica', prompt: 'Seguridad frente a inyección de instrucciones', passed: 'Control registrado aprobado', notPassed: 'No establecido', feedback: 'Comentario del paciente', consistency: 'Observaciones consistentes',
    citations: 'Citas de respaldo', noCitations: 'Sin citas de la KB. El personal debe verificar esta corrección de forma independiente.', version: 'Versión', scope: 'Ámbito de médico / idioma',
    confirmation: 'Revisé la evidencia vigente y confirmo la publicación de este dato exacto de la clínica. Resolví conflictos y quité información privada del paciente.',
    staffReadiness: 'Lista de preparación para revisión', readyForStaffApproval: 'Listo para aprobación del personal', notReadyForStaffApproval: 'Necesita revisión del personal', staffReadinessHint: 'Esta lista describe la evidencia actual. Es independiente de la elegibilidad más estricta para publicación automática que aparece abajo.',
    readinessCitations: 'Las citas están vigentes', readinessConfidence: 'La confianza es de al menos 80%', readinessGrounding: 'El respaldo alcanza el umbral configurado', readinessSafety: 'Los controles de seguridad y riesgo están claros', readinessScope: 'El ámbito de médico e idioma está claro', readinessFeedback: 'No hay corrección ni escalamiento', readinessExpiry: 'La evidencia no ha vencido', readinessReasons: 'Problemas de preparación para personal',
    eligibleForAutomaticApproval: 'Elegible para aprobación automática', notEligibleForAutomaticApproval: 'No es elegible para aprobación automática', automaticEligibilityHint: 'La aprobación automática sigue limitada a datos de horario, repetidos, seguros y con respaldo total. Nunca reemplaza los requisitos de revisión del personal.', automaticReasons: 'Bloqueos de aprobación automática',
    rejectionReason: 'Motivo de rechazo', rejectionDetail: 'Explique el otro motivo', rejection_unsupported: 'Sin respaldo en conocimiento vigente de la clínica', rejection_outdated: 'Información desactualizada', rejection_unsafe: 'Afirmación insegura o sensible', rejection_duplicate: 'Duplicado de conocimiento existente de la clínica', rejection_not_clinic_policy: 'No corresponde a política de la clínica', rejection_other: 'Otro (requiere explicación)',
    edit: 'Guardar borrador de revisión', approve: 'Aprobar y publicar', reject: 'Rechazar candidato', history: 'Historial de este candidato', historyLimit: 'Solo se muestra el historial devuelto de este candidato; no se carga el de sus antecesores.',
    rollback: 'Restaurar esta versión aprobada', rollbackConfirm: 'Revisé este contenido histórico y sus citas y quiero republicarlo como una nueva versión.',
    auto: 'Activar publicación automática protegida', threshold: 'Umbral configurado de respaldo (80–100%)', retention: 'Retención de evidencia temporal (1–24 horas)', save: 'Guardar ajustes',
    thresholdHint: 'La publicación automática sigue requiriendo respaldo del 100%; reducir este ajuste no relaja ese control.',
    accepted: 'Aceptada', corrected: 'Corregida', escalated: 'Escalada', recordFeedback: 'Registrar comentario observado', feedbackHint: 'Registre solo comentarios realmente observados. El silencio no es aceptación.',
    correction: 'Crear borrador de corrección del personal', resolve: 'Marcar vacío como resuelto', correctionConfirm: 'Verifiqué este dato general de la clínica de forma independiente. No contiene detalles privados ni personales del paciente.',
    error: 'La solicitud falló. Actualice y revise los datos actuales antes de reintentar.', conflict: 'El registro o sus fuentes cambiaron, vencieron o no pueden revisarse. Se actualizaron los datos. Abra el registro vigente y vuelva a revisarlo; no se repitió la acción.',
    saved: 'Guardado. Revise el registro actualizado antes de la siguiente acción.', published: 'Publicación confirmada. La indexación vectorial está en cola; esto no confirma que haya terminado.', indexFailed: 'Publicación confirmada, pero falló la indexación vectorial. El contenido aprobado vigente puede seguir disponible en búsqueda léxica. Use Reindexar para reparar la indexación.',
    expiry: 'Vencimiento de evidencia', approver: 'Aprobador / fecha de aprobación', publication: 'Documento publicado / versión', reasons: 'Bloqueos de publicación automática', notAuthed: 'Solo administradores autorizados de la clínica y de Admin Studio pueden revisar esta clínica.',
    lexical: 'Disponible para recuperación léxica', unavailable: 'No se confirma disponibilidad vigente', vector: 'Indexación vectorial', source: 'Fuente', failed: 'Fallida', withdrawn: 'Retirada', governed: 'Aprendizaje supervisado', unknownSource: 'Otra fuente / no verificada',
  },
} as const
