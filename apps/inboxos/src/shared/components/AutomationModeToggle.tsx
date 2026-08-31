'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { automationTransitionSteps, type ConversationMode } from '../conversationMode'
import { useAuthStore } from '../store/auth'

const CAN_CHANGE_MODE = new Set(['secretary', 'clinic_admin', 'ia_studio_admin'])

export function AutomationModeToggle({
  conversationId,
  patientId,
  mode,
}: {
  conversationId: string
  patientId: string
  mode: ConversationMode
}) {
  const qc = useQueryClient()
  const role = useAuthStore((state) => state.user?.role)
  const canChangeMode = role ? CAN_CHANGE_MODE.has(role) : false
  const isSecretaryMode = mode === 'human'

  const mutation = useMutation({
    mutationFn: async (target: ConversationMode) => {
      for (const step of automationTransitionSteps(target, conversationId, patientId)) {
        if (step.method === 'patch') await api.patch(step.path, step.body)
        else await api.post(step.path, step.body)
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
      qc.invalidateQueries({ queryKey: ['patient', patientId] })
    },
  })

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--crm-text-muted)]">
          Mode
        </span>
        {!canChangeMode && (
          <span className="text-[9px] font-semibold text-[var(--crm-text-muted)]">
            View only
          </span>
        )}
      </div>
      <div
        className="grid grid-cols-2 gap-1 rounded-2xl border border-[var(--crm-border-color)] bg-[var(--crm-soft-bg)] p-1"
        aria-label="AI or Secretary handling mode"
      >
        <button
          type="button"
          aria-pressed={!isSecretaryMode}
          disabled={!canChangeMode || mutation.isPending || !isSecretaryMode}
          onClick={() => mutation.mutate('bot')}
          className={`rounded-xl px-2.5 py-1.5 text-[10px] font-extrabold transition disabled:cursor-default disabled:opacity-100 ${!isSecretaryMode ? 'bg-violet-100 text-violet-700 shadow-sm dark:bg-violet-950/60 dark:text-violet-200' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-card-bg)] hover:text-violet-700'}`}
        >
          AI
        </button>
        <button
          type="button"
          aria-pressed={isSecretaryMode}
          disabled={!canChangeMode || mutation.isPending || isSecretaryMode}
          onClick={() => mutation.mutate('human')}
          className={`rounded-xl px-2.5 py-1.5 text-[10px] font-extrabold transition disabled:cursor-default disabled:opacity-100 ${isSecretaryMode ? 'bg-emerald-100 text-emerald-700 shadow-sm dark:bg-emerald-950/60 dark:text-emerald-200' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-card-bg)] hover:text-emerald-700'}`}
        >
          Secretary
        </button>
      </div>
      {mutation.isError && (
        <span role="alert" className="text-[10px] font-semibold text-red-600">Mode change failed. Try again.</span>
      )}
    </div>
  )
}
