// Req 10 (Patient Data Capture): shared helpers for the structured patient intake
// that the inbound + scheduling workers populate. Kept dependency-free (type-only
// DB import, erased at runtime) so the logic is unit-testable without a DB.
import type { Patient, Channel } from '@docmee/db'

/**
 * The intake captured for a patient on first contact. For WhatsApp the contact
 * handle IS the international phone number, so `phone` is set; for Messenger /
 * Instagram the handle is an opaque PSID/IGSID, so only `contactHandle` + `source`
 * are recorded. `source` is the channel the patient first reached the clinic on.
 */
export function firstContactMetadata(
  channel: Channel,
  contactHandle: string,
): Record<string, unknown> {
  return {
    source: channel,
    contactHandle,
    ...(channel === 'whatsapp' ? { phone: contactHandle } : {}),
  }
}

/** The booking-time intake collected by the calbot flow (Req 10). */
export interface BookingIntake {
  reason: string
  preferredDate: string
  preferredTime: string
  doctorId: string
  doctorName: string | null
  specialty: string | null
  source: string | null
  /** Req 30: the service the patient booked, when the doctor offers services. */
  serviceId?: string | null
}

/** Read the patient's first-contact source channel, if it was captured. */
export function patientSource(patient: Patient | null): string | null {
  const s = patient ? (patient.metadata as { source?: unknown }).source : undefined
  return typeof s === 'string' ? s : null
}

/**
 * Merge the latest booking intake onto the patient's existing metadata under an
 * `intake` key, preserving any other metadata (e.g. detected `language`) and any
 * intake fields not overwritten by this booking.
 */
export function mergePatientIntake(
  metadata: Record<string, unknown>,
  intake: BookingIntake,
): Record<string, unknown> {
  const prev = metadata['intake']
  const prevIntake = prev && typeof prev === 'object' ? (prev as Record<string, unknown>) : {}
  return { ...metadata, intake: { ...prevIntake, ...intake } }
}
