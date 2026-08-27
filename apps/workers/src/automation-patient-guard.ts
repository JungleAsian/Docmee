import { isHumanOnly } from '@docmee/shared'
import type { Patient, PatientsRepository } from '@docmee/db'

/**
 * Resolve the current patient record at an automated trust boundary.
 *
 * Queue payloads are only hints: the patient may have been deleted, moved to a
 * different clinic, or switched to secretary-only ownership after the job was
 * enqueued. Call this again immediately before provider delivery so stale jobs
 * fail closed instead of speaking as the bot.
 */
export async function resolveAutomationEligiblePatient(
  patients: Pick<PatientsRepository, 'findById'>,
  clinicId: string,
  patientId: string | undefined,
  worker: string,
): Promise<Patient | null> {
  if (!patientId) {
    console.warn(`[${worker}] automated delivery blocked: job has no patient identity`)
    return null
  }

  const patient = await patients.findById(clinicId, patientId)
  if (!patient) {
    console.warn(`[${worker}] automated delivery blocked: patient ${patientId} was not resolved`)
    return null
  }
  if (isHumanOnly(patient)) {
    console.log(`[${worker}] patient ${patientId} is human-only; suppressing automation`)
    return null
  }

  return patient
}
