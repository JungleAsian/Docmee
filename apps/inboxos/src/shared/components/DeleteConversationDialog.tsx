'use client'

// Password-confirm modal for the real hard-delete of a conversation — genuinely
// irreversible, so it requires a fresh password check, not just a click-through
// confirm (mirrors the clinic-delete dialog on Studio's Clinics page). Modeled on
// ConfirmDialog.tsx's Escape/backdrop-close/focus pattern with a password field
// grafted in. Not table-row-scoped like the clinic version — this needs to work
// standalone from both the full Inbox and the floating chat-bubble widget.
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useI18n } from '../hooks/useI18n'

interface DeleteConversationDialogProps {
  open: boolean
  conversationId: string
  onClose: () => void
  onDeleted: () => void
}

export function DeleteConversationDialog({
  open,
  conversationId,
  onClose,
  onDeleted,
}: DeleteConversationDialogProps) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const passwordRef = useRef<HTMLInputElement>(null)

  const mutation = useMutation({
    mutationFn: () => api.del(`/conversations/${conversationId}`, { password }),
    onSuccess: () => {
      setPassword('')
      qc.invalidateQueries({ queryKey: ['conversations'] })
      onDeleted()
    },
  })

  useEffect(() => {
    if (!open) return
    setPassword('')
    passwordRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        data-docmee-glass="strong"
        aria-modal="true"
        aria-labelledby="delete-conv-title"
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="delete-conv-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {t('view.deleteTitle')}
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{t('view.deleteHint')}</p>
        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-gray-500">{t('view.deleteConfirmPassword')}</span>
          <input
            ref={passwordRef}
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-950"
          />
        </label>
        {mutation.isError && (
          <p className="mt-2 text-xs text-red-600">
            {mutation.error instanceof ApiError ? mutation.error.message : t('common.error')}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={!password.trim() || mutation.isPending}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {mutation.isPending ? t('common.saving') : t('view.deleteConfirm')}
          </button>
        </div>
      </div>
    </div>
  )
}
