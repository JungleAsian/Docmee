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
