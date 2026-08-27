// Req 40: runtime feature flags. Single source of truth for which optional
// surfaces are enabled, read fresh from the environment on every call so a flag
// can be toggled without a code change (and flipped between requests in tests).
//
// The frontend learns the same booleans via the public GET /config route, so the
// flag is enforced in exactly one place (the env) and mirrored to the UI.
import { parseEnv } from '../plugins/env.js'
import { withDb } from './db.js'
import { createHash } from 'node:crypto'

const expansionFlagNames = {
  inboxLayoutV2: 'docmee_inbox_layout_v2',
  humanOnlyMode: 'docmee_human_only_mode',
  classifications: 'docmee_classifications',
  calendarPolicyV2: 'docmee_calendar_policy_v2',
  mediaRepository: 'docmee_media_repository',
  notificationChimes: 'docmee_notification_chimes',
  workflowEdgesV2: 'docmee_workflow_edges_v2',
} as const

export type DocmeeExpansionFeature = keyof typeof expansionFlagNames
export type DocmeeExpansionFeatures = Record<DocmeeExpansionFeature, boolean>

const disabledExpansionFeatures = (): DocmeeExpansionFeatures => ({
  inboxLayoutV2: false,
  humanOnlyMode: false,
  classifications: false,
  calendarPolicyV2: false,
  mediaRepository: false,
  notificationChimes: false,
  workflowEdgesV2: false,
})

export interface Features {
  /** Advanced analytics dashboard + GET /clinics/:id/analytics route. */
  advancedAnalytics: boolean
}

export function getFeatures(): Features {
  const env = parseEnv()
  return {
    advancedAnalytics: env.FEATURE_ADVANCED_ANALYTICS,
  }
}

/** Read the migration-backed rollout switches at runtime. Missing rows or DB
 * failures fail closed so an operator can immediately withdraw new surfaces. */
type ExpansionFlagRow = {
  name: string
  clinicId: string | null
  enabled: boolean
  rolloutPercentage: number
}

function isInRollout(name: string, percentage: number, clinicId?: string): boolean {
  if (percentage >= 100) return true
  if (percentage <= 0 || !clinicId) return false
  const digest = createHash('sha256').update(`${name}:${clinicId}`).digest()
  return digest.readUInt32BE(0) % 100 < percentage
}

export async function getDocmeeExpansionFeatures(clinicId?: string): Promise<DocmeeExpansionFeatures> {
  const result = disabledExpansionFeatures()
  try {
    const rows = await withDb(async (sql) => sql<ExpansionFlagRow[]>`
      SELECT name, clinic_id, enabled, rollout_percentage
      FROM feature_flags
      WHERE (clinic_id IS NULL OR clinic_id = ${clinicId ?? null})
        AND name = ANY(${Object.values(expansionFlagNames)})
      ORDER BY name, (clinic_id IS NOT NULL) DESC, updated_at DESC
    `)
    for (const [feature, name] of Object.entries(expansionFlagNames) as Array<[DocmeeExpansionFeature, string]>) {
      // A clinic row is an explicit override (including an explicit disable).
      // Otherwise use the newest global row. Percentage rollout is stable for a
      // clinic, while anonymous config requests fail closed unless rollout is 100%.
      const row = rows.find((candidate) => candidate.name === name && candidate.clinicId === clinicId)
        ?? rows.find((candidate) => candidate.name === name && candidate.clinicId === null)
      result[feature] = Boolean(row?.enabled && isInRollout(name, row.rolloutPercentage, clinicId))
    }
  } catch {
    // Config remains available during DB startup, but all expansion features are
    // withdrawn until their durable rollout state can be proven.
  }
  return result
}

export async function isDocmeeExpansionFeatureEnabled(feature: DocmeeExpansionFeature, clinicId?: string): Promise<boolean> {
  return (await getDocmeeExpansionFeatures(clinicId))[feature]
}
