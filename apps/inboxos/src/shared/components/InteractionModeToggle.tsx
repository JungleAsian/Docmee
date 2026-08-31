'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { interactionMode, staffOptOutRequest, type InteractionMode } from '../patientInteraction'
import { useAuthStore } from '../store/auth'

const CAN_CHANGE_MODE = new Set(['secretary', 'clinic_admin', 'ia_studio_admin'])

export function InteractionModeToggle({ patientId, metadata }: { patientId: string; metadata?: Record<string, unknown> }) {
  const qc = useQueryClient()
  const role = useAuthStore((state) => state.user?.role)
  const canChangeMode = role ? CAN_CHANGE_MODE.has(role) : false
  const mode = interactionMode(metadata)
  const isOptedOut = mode === 'opted_out'

  const mutation = useMutation({
    mutationFn: async (target: InteractionMode) => {
      const request = staffOptOutRequest(patientId, target)
      await api.patch(request.path, request.body)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['patient', patientId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--crm-text-muted)]">
          Automation
        </span>
        {!canChangeMode && (
          <span className="text-[9px] font-semibold text-[var(--crm-text-muted)]">
            View only
          </span>
        )}
      </div>
      <div
        className="grid grid-cols-2 gap-1 rounded-2xl border border-[var(--crm-border-color)] bg-[var(--crm-soft-bg)] p-1"
        aria-label="Opt-in or Opt-out automation status"
      >
        <button
          type="button"
          aria-pressed={!isOptedOut}
          disabled={!canChangeMode || mutation.isPending || !isOptedOut}
          onClick={() => mutation.mutate('active')}
          className={`rounded-xl px-2.5 py-1.5 text-[10px] font-extrabold transition disabled:cursor-default disabled:opacity-100 ${!isOptedOut ? 'bg-sky-100 text-sky-700 shadow-sm dark:bg-sky-950/60 dark:text-sky-200' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-card-bg)] hover:text-sky-700'}`}
        >
          Opt-in
        </button>
        <button
          type="button"
          aria-pressed={isOptedOut}
          disabled={!canChangeMode || mutation.isPending || isOptedOut}
          onClick={() => mutation.mutate('opted_out')}
          className={`rounded-xl px-2.5 py-1.5 text-[10px] font-extrabold transition disabled:cursor-default disabled:opacity-100 ${isOptedOut ? 'bg-rose-100 text-rose-700 shadow-sm dark:bg-rose-950/60 dark:text-rose-200' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-card-bg)] hover:text-rose-700'}`}
        >
          Opt-out
        </button>
      </div>
      {mutation.isError && (
        <span role="alert" className="text-[10px] font-semibold text-red-600">Interaction change failed. Try again.</span>
      )}
    </div>
  )
}
