import type { LayaControls, LayaMode, LayaTask } from './adapter.js'

const modes: LayaMode[] = ['disabled', 'shadow', 'advisory', 'live']
const tasks: LayaTask[] = ['administrative_intent', 'workflow_branch', 'kb_relevance']
const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const unconfigured = (): LayaControls['qualification'] => ({
  reviewed: false, modelVersion: 'unconfigured', calibrationVersion: 'unconfigured', thresholds: {},
})
const disabled = (): LayaControls => ({
  enabled: false, maximumMode: 'disabled', clinicMode: 'disabled', tasks: [], qualification: unconfigured(),
})

function parseFlag(value: Record<string, unknown>): { mode: LayaMode; tasks: LayaTask[] } | null {
  const metadata = value.metadata
  if (value.enabled !== true || value.rolloutPercentage !== 100 || !isObject(metadata)
    || Object.keys(metadata).length !== 3 || metadata.schemaVersion !== 1
    || !modes.includes(metadata.mode as LayaMode) || !Array.isArray(metadata.tasks)
    || metadata.tasks.length > tasks.length || metadata.tasks.some(task => !tasks.includes(task))
    || new Set(metadata.tasks).size !== metadata.tasks.length) return null
  return { mode: metadata.mode as LayaMode, tasks: [...metadata.tasks] as LayaTask[] }
}

/** Global authorization AND clinic opt-in; never infer enablement from a clinic settings blob. */
export function resolveLayaControls(
  clinicId: string, rows: unknown, qualification?: LayaControls['qualification'],
): LayaControls {
  if (typeof clinicId !== 'string' || !clinicId.trim() || clinicId.length > 128 || !Array.isArray(rows)
    || rows.length > 1000 || rows.some(row => !isObject(row))) return disabled()
  const relevant = rows.filter(row => row.name === 'docmee_laya') as Record<string, unknown>[]
  const globals = relevant.filter(row => row.clinicId === null)
  const clinics = relevant.filter(row => row.clinicId === clinicId)
  // The legacy table's nullable unique key permits duplicate global rows. Do not choose a winner.
  if (globals.length !== 1 || clinics.length !== 1) return disabled()
  const global = parseFlag(globals[0]!)
  const clinic = parseFlag(clinics[0]!)
  if (!global || !clinic) return disabled()
  const allowedTasks = tasks.filter(task => global.tasks.includes(task) && clinic.tasks.includes(task))
  return {
    enabled: global.mode !== 'disabled' && clinic.mode !== 'disabled' && allowedTasks.length > 0,
    maximumMode: global.mode, clinicMode: clinic.mode, tasks: allowedTasks,
    qualification: structuredClone(qualification ?? unconfigured()),
  }
}

/** Fresh reads before/after inference make durable disablement effective without a redeploy or cache expiry. */
export function createLayaControlsReader(
  readRows: (clinicId: string) => Promise<unknown>, qualification?: LayaControls['qualification'],
) {
  const reviewedQualification = structuredClone(qualification ?? unconfigured())
  return async (clinicId: string): Promise<LayaControls> => {
    try { return resolveLayaControls(clinicId, await readRows(clinicId), reviewedQualification) }
    catch { return disabled() }
  }
}
