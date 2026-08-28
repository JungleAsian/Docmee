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

  if (!canChangeMode) {
    return (
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${isOptedOut ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300'}`}>
        {isOptedOut ? 'Opt-out' : 'Active'}
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={isOptedOut}
        aria-label="Switch between Active and Opt-out"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(isOptedOut ? 'active' : 'opted_out')}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] px-2.5 py-1.5 text-[10px] font-bold shadow-sm transition disabled:cursor-wait disabled:opacity-60"
      >
        <span className={!isOptedOut ? 'text-sky-600 dark:text-sky-300' : 'text-[var(--crm-text-muted)]'}>Active</span>
        <span className={`relative h-5 w-9 rounded-full transition ${isOptedOut ? 'bg-rose-500' : 'bg-sky-500'}`} aria-hidden>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${isOptedOut ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
        <span className={isOptedOut ? 'text-rose-600 dark:text-rose-300' : 'text-[var(--crm-text-muted)]'}>Opt-out</span>
      </button>
      {mutation.isError && (
        <span role="alert" className="text-[10px] font-semibold text-red-600">Interaction change failed. Try again.</span>
      )}
    </div>
  )
}
