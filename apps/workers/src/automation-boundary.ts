import type { Patient } from '@docmee/db'

/** A human-only patient may be recorded and shown to staff, but no worker may
 * resume an automation or produce an automated outbound message for them. */
export function patientAllowsAutomation(patient: Patient | null | undefined): boolean {
  return Boolean(patient && patient.automationMode !== 'human_only')
}
