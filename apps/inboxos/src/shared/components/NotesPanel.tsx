'use client'

// Gap #14 / Req 13 — Internal notes panel. Notes are clinic-internal and are NEVER
// sent to the patient — the warning banner + per-note "Private" badge make that
// explicit at the point of entry. The author of a note may edit or delete it.
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { useTeam } from '../hooks/useTeam'
import { useAuthStore } from '../store/auth'
import { formatDateTime } from '../format'
import type { Note, TeamMember } from '../types'

export function NotesPanel({ conversationId }: { conversationId: string }) {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const team = useTeam()
  const currentUserId = useAuthStore((s) => s.user?.id)
  const key = ['notes', conversationId]
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ notes: Note[] }>(`/conversations/${conversationId}/notes`),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: key })

  const addMutation = useMutation({
    mutationFn: (content: string) => api.post(`/conversations/${conversationId}/notes`, { content }),
    onSuccess: () => {
      setDraft('')
      invalidate()
    },
  })

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.patch(`/conversations/${conversationId}/notes/${id}`, { content }),
    onSuccess: () => {
      setEditingId(null)
      setEditDraft('')
      invalidate()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/conversations/${conversationId}/notes/${id}`),
    onSuccess: invalidate,
  })

  const notes = query.data?.notes ?? []

  function authorName(authorId: string): string {
    const member = team.find((m: TeamMember) => m.id === authorId)
    return member?.fullName || member?.email || t('notes.unknownAuthor')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const content = draft.trim()
    if (content) addMutation.mutate(content)
  }

  function startEdit(n: Note) {
    setEditingId(n.id)
    setEditDraft(n.content)
  }

  function saveEdit(e: FormEvent) {
    e.preventDefault()
    const content = editDraft.trim()
    if (editingId && content) editMutation.mutate({ id: editingId, content })
  }

  function onDelete(id: string) {
    if (window.confirm(t('notes.deleteConfirm'))) deleteMutation.mutate(id)
  }

  return (
    <section className="border-b border-gray-200 p-3 dark:border-gray-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('notes.title')}</h3>

      <p className="mb-2 rounded-md bg-amber-50 px-2 py-1.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
        {t('notes.warning')}
      </p>

      <div className="mb-2 space-y-2">
        {query.isLoading ? (
          <p className="text-xs text-gray-400">{t('common.loading')}</p>
        ) : notes.length === 0 ? (
          <p className="text-xs text-gray-400">{t('notes.empty')}</p>
        ) : (
          notes.map((n) => {
            const isAuthor = n.authorId === currentUserId
            const wasEdited = n.updatedAt && n.updatedAt !== n.createdAt
            return (
              <div key={n.id} className="rounded-md bg-gray-50 p-2 text-xs dark:bg-gray-800">
                <div className="mb-1 flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 rounded bg-gray-200 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                    🔒 {t('notes.private')}
                  </span>
                  <span className="text-[10px] font-medium text-gray-600 dark:text-gray-300">
                    {authorName(n.authorId)}
                  </span>
                </div>

                {editingId === n.id ? (
                  <form onSubmit={saveEdit} className="space-y-1.5">
                    <textarea
                      value={editDraft}
                      onChange={(e) => setEditDraft(e.target.value)}
                      rows={2}
                      className="w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-900"
                    />
                    <div className="flex gap-1.5">
                      <button
                        type="submit"
                        disabled={editMutation.isPending || !editDraft.trim()}
                        className="rounded-md bg-gray-800 px-2 py-1 text-[11px] font-semibold text-white hover:bg-gray-900 disabled:opacity-60 dark:bg-gray-700 dark:hover:bg-gray-600"
                      >
                        {t('notes.save')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                      >
                        {t('notes.cancel')}
                      </button>
                    </div>
                  </form>
                ) : (
                  <p className="whitespace-pre-wrap break-words">{n.content}</p>
                )}

                <div className="mt-1 flex items-center justify-between">
                  <p className="text-[10px] text-gray-400">
                    {formatDateTime(n.createdAt, language)}
                    {wasEdited ? ` · ${t('notes.edited')}` : ''}
                  </p>
                  {isAuthor && editingId !== n.id ? (
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => startEdit(n)}
                        className="text-[10px] font-medium text-teal-700 hover:underline dark:text-teal-400"
                      >
                        {t('notes.edit')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onDelete(n.id)}
                        disabled={deleteMutation.isPending}
                        className="text-[10px] font-medium text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
                      >
                        {t('notes.delete')}
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })
        )}
      </div>

      <form onSubmit={onSubmit} className="space-y-1.5">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={t('notes.placeholder')}
          className="w-full resize-none rounded-md border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
        />
        <button
          type="submit"
          disabled={addMutation.isPending || !draft.trim()}
          className="w-full rounded-md bg-gray-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-900 disabled:opacity-60 dark:bg-gray-700 dark:hover:bg-gray-600"
        >
          {t('notes.add')}
        </button>
      </form>
    </section>
  )
}
