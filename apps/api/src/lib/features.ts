// Req 40: runtime feature flags. Single source of truth for which optional
// surfaces are enabled, read fresh from the environment on every call so a flag
// can be toggled without a code change (and flipped between requests in tests).
//
// The frontend learns the same booleans via the public GET /config route, so the
// flag is enforced in exactly one place (the env) and mirrored to the UI.
import { parseEnv } from '../plugins/env.js'

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
