// Gap #13 / Req 11 — the canonical conversation tag palette. `name` is the stable
// value stored/queried via the API; the labels are display-only and localized.
// Several of these are applied automatically by the workers: `new_patient` (first
// contact) and `appointment_scheduled` (booking confirmed), plus the safety/
// compliance flags `emergency` + `medical_safety` (Req 20), `opted_out` (Req 19)
// and `patient_upset` (Req 18). Every worker-applied tag MUST live here so it
// renders with a label/colour in the TagsPanel (which only shows palette entries)
// instead of an invisible or raw-string flag — see tagTypes.test.ts.
import type { PanelLanguage } from './types'

export interface TagType {
  name: string
  labelEs: string
  labelEn: string
  color: string
}

export const TAG_TYPES: TagType[] = [
  // Safety / compliance flags raised automatically by the workers. Kept at the top
  // so the most consequential states are the first chips a secretary sees.
  { name: 'emergency', labelEs: 'Emergencia', labelEn: 'Emergency', color: '#dc2626' },
  { name: 'needs_human', labelEs: 'Necesita atención humana', labelEn: 'Needs human attention', color: '#dc2626' },
  { name: 'medical_safety', labelEs: 'Seguridad médica', labelEn: 'Medical safety', color: '#dc2626' },
  { name: 'patient_upset', labelEs: 'Paciente molesto', labelEn: 'Upset patient', color: '#ea580c' },
  { name: 'opted_out', labelEs: 'Dado de baja', labelEn: 'Opted out', color: '#6b7280' },
  { name: 'urgent', labelEs: 'Urgente', labelEn: 'Urgent', color: '#dc2626' },
  { name: 'appointment', labelEs: 'Cita', labelEn: 'Appointment', color: '#2563eb' },
  { name: 'appointment_scheduled', labelEs: 'Cita agendada', labelEn: 'Appointment scheduled', color: '#2563eb' },
  { name: 'reschedule', labelEs: 'Reprogramar', labelEn: 'Reschedule', color: '#7c3aed' },
  { name: 'cancellation', labelEs: 'Cancelación', labelEn: 'Cancellation', color: '#b91c1c' },
  { name: 'billing', labelEs: 'Facturación', labelEn: 'Billing', color: '#0891b2' },
  { name: 'insurance', labelEs: 'Seguro', labelEn: 'Insurance', color: '#0d9488' },
  { name: 'prescription', labelEs: 'Receta', labelEn: 'Prescription', color: '#65a30d' },
  { name: 'results', labelEs: 'Resultados', labelEn: 'Results', color: '#ca8a04' },
  { name: 'complaint', labelEs: 'Queja', labelEn: 'Complaint', color: '#ea580c' },
  { name: 'follow_up', labelEs: 'Seguimiento', labelEn: 'Follow-up', color: '#0d9488' },
  { name: 'new_patient', labelEs: 'Paciente nuevo', labelEn: 'New patient', color: '#16a34a' },
  { name: 'vip', labelEs: 'VIP', labelEn: 'VIP', color: '#d97706' },
  { name: 'spam', labelEs: 'Spam', labelEn: 'Spam', color: '#6b7280' },
]

export function tagLabel(name: string, language: PanelLanguage): string {
  const type = TAG_TYPES.find((tt) => tt.name === name)
  if (!type) return name
  return language === 'es' ? type.labelEs : type.labelEn
}

export function tagColor(name: string): string {
  return TAG_TYPES.find((tt) => tt.name === name)?.color ?? '#14b8a6'
}
