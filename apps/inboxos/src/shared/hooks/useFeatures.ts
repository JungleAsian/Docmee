'use client'

// Req 40: server feature-flag discovery. Fetches the public GET /config once and
// caches it, so gated surfaces (advanced analytics) show only when the API has the
// flag enabled. The single source of truth is the API env; this just mirrors it.
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Features } from '../types'

const DEFAULT_FEATURES: Features = {
  advancedAnalytics: false,
  inboxLayoutV2: false,
  humanOnlyMode: false,
  classifications: false,
  calendarPolicyV2: false,
  mediaRepository: false,
  notificationChimes: false,
  workflowEdgesV2: false,
}

export function useFeatures(): { features: Features; ready: boolean } {
  const query = useQuery({
    queryKey: ['config'],
    // Rollback switches must take effect in an already-open operator session.
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: () => api.get<{ features: Features }>('/config'),
  })
  return {
    features: query.data?.features ?? DEFAULT_FEATURES,
    ready: !query.isLoading,
  }
}
