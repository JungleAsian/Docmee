'use client'

// Shared team-members query (P16). The conversation list uses it to label the
// assignee, and the assign control in the conversation header uses it to populate
// its dropdown. Any authenticated clinic user may read their clinic's team.
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useActiveClinic } from './useActiveClinic'
import type { TeamMember } from '../types'

export function useTeam(enabled = true) {
  const { clinicId } = useActiveClinic()
  const query = useQuery({
    queryKey: ['team', clinicId],
    enabled: Boolean(clinicId) && enabled,
    queryFn: () => api.get<{ members: TeamMember[] }>(`/clinics/${clinicId}/team`),
  })
  return query.data?.members ?? []
}
