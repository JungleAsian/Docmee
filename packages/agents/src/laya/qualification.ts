import type { LayaControls, LayaLanguage, LayaTask } from './adapter.js'

type Qualification = LayaControls['qualification']

const tasks: LayaTask[] = ['administrative_intent', 'workflow_branch', 'kb_relevance']
const languages: LayaLanguage[] = ['en', 'es', 'mixed', 'unknown']
const keys = ['reviewed', 'modelVersion', 'calibrationVersion', 'thresholds']
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const version = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value)

/**
 * Reads the server-owned qualification record (DOCMEE_LAYA_QUALIFICATION).
 *
 * The record pins the model/calibration versions the runtime must report, and
 * says whether a person has reviewed held-out accuracy. `reviewed: false` with
 * the right versions lets watch-only (shadow) mode see real model choices while
 * every decision stays blocked. Anything malformed returns undefined, which the
 * controls reader treats as "unconfigured": every response is then rejected.
 */
export function parseLayaQualification(raw: string | undefined): Qualification | undefined {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 4096) return undefined
  let value: unknown
  try { value = JSON.parse(raw) } catch { return undefined }
  if (!isObject(value) || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return undefined
  if (typeof value.reviewed !== 'boolean' || !version(value.modelVersion) || !version(value.calibrationVersion)
    || !isObject(value.thresholds)) return undefined
  const thresholds: Qualification['thresholds'] = {}
  for (const [key, threshold] of Object.entries(value.thresholds)) {
    if (!tasks.some(task => languages.some(language => key === `${task}:${language}`))) return undefined
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) return undefined
    thresholds[key as keyof Qualification['thresholds']] = threshold
  }
  // A reviewed record without any threshold could never apply anything; refuse it
  // so a half-finished sign-off is visible as "unconfigured" rather than silent.
  if (value.reviewed && Object.keys(thresholds).length === 0) return undefined
  return { reviewed: value.reviewed, modelVersion: value.modelVersion, calibrationVersion: value.calibrationVersion, thresholds }
}

export type LayaQualificationStatus = 'unconfigured' | 'unqualified' | 'reviewed'

export function layaQualificationStatus(qualification: Qualification | undefined): LayaQualificationStatus {
  if (!qualification || qualification.modelVersion === 'unconfigured') return 'unconfigured'
  return qualification.reviewed ? 'reviewed' : 'unqualified'
}
