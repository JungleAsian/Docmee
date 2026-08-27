// Req 40: runtime feature flags. Single source of truth for which optional
// surfaces are enabled, read fresh from the environment on every call so a flag
// can be toggled without a code change (and flipped between requests in tests).
//
// The frontend learns the same booleans via the public GET /config route, so the
// flag is enforced in exactly one place (the env) and mirrored to the UI.
import { parseEnv } from '../plugins/env.js'
import { withDb } from './db.js'

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
export async function getDocmeeExpansionFeatures(): Promise<DocmeeExpansionFeatures> {
  const result = disabledExpansionFeatures()
  try {
    const rows = await withDb(async (sql) => sql<Array<{ name: string }>>`
      SELECT name
      FROM feature_flags
      WHERE clinic_id IS NULL
        AND enabled = TRUE
        AND rollout_percentage > 0
        AND name = ANY(${Object.values(expansionFlagNames)})
    `)
    const enabled = new Set(rows.map((row) => row.name))
    for (const [feature, name] of Object.entries(expansionFlagNames) as Array<[DocmeeExpansionFeature, string]>) {
      result[feature] = enabled.has(name)
    }
  } catch {
    // Config remains available during DB startup, but all expansion features are
    // withdrawn until their durable rollout state can be proven.
  }
  return result
}

export async function isDocmeeExpansionFeatureEnabled(feature: DocmeeExpansionFeature): Promise<boolean> {
  return (await getDocmeeExpansionFeatures())[feature]
}
