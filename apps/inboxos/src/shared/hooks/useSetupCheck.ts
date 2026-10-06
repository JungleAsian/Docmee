'use client'

// Current clinic setup problems (configuration + live workflows), for admins.
// Refreshed on focus and after every successful save anywhere in the panel
// (see the MutationCache in app/providers.tsx), so a mistake shows up right away.
import { useQuery } from '@tanstack/react-query'
import { api, type ApiIssue } from '../api/client'
import { useActiveClinic } from './useActiveClinic'
import { useAuthStore } from '../store/auth'

export interface SetupIssue extends ApiIssue {
  key: string
  severity: 'error' | 'warning'
  href?: string
  workflowId?: string
}

export const SETUP_CHECK_QUERY_KEY = 'setup-check'

export function canSeeSetupCheck(role: string | undefined): boolean {
  return role === 'clinic_admin' || role === 'ia_studio_admin'
}

export function useSetupCheck() {
  const role = useAuthStore((state) => state.user?.role)
  const { clinicId } = useActiveClinic()
  return useQuery({
    queryKey: [SETUP_CHECK_QUERY_KEY, clinicId],
    enabled: canSeeSetupCheck(role) && Boolean(clinicId),
    staleTime: 30_000,
    retry: false,
    queryFn: () => api.get<{ issues: SetupIssue[]; checkedAt: string }>(`/clinics/${clinicId}/setup-check`),
  })
}
