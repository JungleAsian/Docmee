'use client'

// Screen 13 — Meta submission checklist persistence (Features 19, 21).
// The operator self-tracker used to live in localStorage (per-browser, lost on a
// different device). It now persists per-clinic in `clinic.settings.complianceChecklist`
// via the existing GET/PATCH /clinics/:id route, scoped to the active clinic, so the
// same progress shows on every device for that tenant. Writes are optimistic: the
// click updates the cached clinic immediately and reverts if the PATCH fails (e.g.
// offline). PATCH merges the settings blob server-side, so unrelated keys are safe.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useActiveClinic } from './useActiveClinic'
import type { Clinic } from '../types'

export type ComplianceItemStatus = 'pending' | 'in_review' | 'done'
export interface ComplianceStoredItem {
  status: ComplianceItemStatus
  date?: string
}
export type ComplianceState = Record<string, ComplianceStoredItem>

function readChecklist(clinic: Clinic | undefined): ComplianceState {
  const raw = clinic?.settings?.['complianceChecklist']
  return raw && typeof raw === 'object' ? (raw as ComplianceState) : {}
}

export interface UseComplianceChecklist {
  clinicId: string
  state: ComplianceState
  /** Persist the full next state (optimistic; reverts on failure). */
  save: (next: ComplianceState) => void
  isLoading: boolean
  isError: boolean
  isSaving: boolean
  refetch: () => void
}

export function useComplianceChecklist(): UseComplianceChecklist {
  const { clinicId } = useActiveClinic()
  const qc = useQueryClient()
  // Scoped key (not the clinic-detail page's ['clinic', id]) so the two surfaces
  // don't fight over cache shape; both ultimately hit GET /clinics/:id.
  const queryKey = ['clinic', clinicId, 'compliance'] as const

  const query = useQuery({
    queryKey,
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: Clinic }>(`/clinics/${clinicId}`),
  })

  const mutation = useMutation({
    mutationFn: (next: ComplianceState) =>
      api.patch<{ clinic: Clinic }>(`/clinics/${clinicId}`, {
        settings: { complianceChecklist: next },
      }),
    // Optimistic: patch the cached clinic so the checklist updates instantly.
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey })
      const previous = qc.getQueryData<{ clinic: Clinic }>(queryKey)
      if (previous) {
        qc.setQueryData<{ clinic: Clinic }>(queryKey, {
          clinic: {
            ...previous.clinic,
            settings: { ...previous.clinic.settings, complianceChecklist: next },
          },
        })
      }
      return { previous }
    },
    onError: (_err, _next, context) => {
      if (context?.previous) qc.setQueryData(queryKey, context.previous)
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey })
    },
  })

  return {
    clinicId,
    state: readChecklist(query.data?.clinic),
    save: (next) => mutation.mutate(next),
    isLoading: query.isLoading,
    isError: query.isError,
    isSaving: mutation.isPending,
    refetch: () => void query.refetch(),
  }
}
