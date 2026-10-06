'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { normalizeUserUiPreferences, type UserUiPreferences } from '../userUiPreferences'

export function useUserUiPreferences() {
  const qc = useQueryClient()
  const accessToken = useAuthStore((state) => state.accessToken)
  const query = useQuery({
    queryKey: ['user-ui-preferences'],
    enabled: Boolean(accessToken),
    queryFn: async () => {
      const data = await api.get<{ preferences?: unknown }>('/user/ui-preferences')
      return normalizeUserUiPreferences(data.preferences)
    },
  })

  const mutation = useMutation({
    mutationFn: (patch: Partial<UserUiPreferences>) =>
      api.put<{ preferences: unknown }>('/user/ui-preferences', patch),
    // Apply the change to the cache immediately. Components that remount while
    // the save is in flight (e.g. a layout switch after "View all updates") must
    // see the new value, not the stale one, or they act on outdated preferences.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['user-ui-preferences'] })
      const previous = qc.getQueryData<UserUiPreferences>(['user-ui-preferences'])
      qc.setQueryData(['user-ui-preferences'], { ...(previous ?? normalizeUserUiPreferences(null)), ...patch })
      return { previous }
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) qc.setQueryData(['user-ui-preferences'], context.previous)
    },
    onSuccess: (data) => {
      qc.setQueryData(['user-ui-preferences'], normalizeUserUiPreferences(data.preferences))
    },
  })

  return {
    preferences: query.data ?? normalizeUserUiPreferences(null),
    isLoading: query.isLoading,
    isSaving: mutation.isPending,
    setPreferences: mutation.mutate,
  }
}
