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

  if (!canChangeMode) {
    return (
      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${isSecretaryMode ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300'}`}>
        {isSecretaryMode ? 'Secretary' : 'AI'}
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={isSecretaryMode}
        aria-label="Switch between AI mode and Secretary mode"
        disabled={mutation.isPending}
        onClick={() => mutation.mutate(isSecretaryMode ? 'bot' : 'human')}
        className="inline-flex items-center gap-2 rounded-full border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] px-2.5 py-1.5 text-[10px] font-bold shadow-sm transition disabled:cursor-wait disabled:opacity-60"
      >
        <span className={!isSecretaryMode ? 'text-violet-600 dark:text-violet-300' : 'text-[var(--crm-text-muted)]'}>AI</span>
        <span className={`relative h-5 w-9 rounded-full transition ${isSecretaryMode ? 'bg-emerald-500' : 'bg-violet-500'}`} aria-hidden>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${isSecretaryMode ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
        <span className={isSecretaryMode ? 'text-emerald-600 dark:text-emerald-300' : 'text-[var(--crm-text-muted)]'}>Secretary</span>
      </button>
      {mutation.isError && (
        <span role="alert" className="text-[10px] font-semibold text-red-600">Mode change failed. Try again.</span>
      )}
    </div>
  )
}
