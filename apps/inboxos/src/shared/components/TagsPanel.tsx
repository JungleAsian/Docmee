'use client'

// Gap #13 — Tags panel. Shows the tags currently on a conversation and a palette
// of the 13 canonical tag types to toggle. Tags are clinic-scoped; adding one
// creates the clinic tag (idempotent) and links it.
import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { TAG_TYPES, tagColor, tagLabel } from '../tagTypes'
import type { Tag } from '../types'

export function TagsPanel({ conversationId }: { conversationId: string }) {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const key = ['tags', conversationId]

  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get<{ tags: Tag[] }>(`/conversations/${conversationId}/tags`),
  })
  const active = useMemo(() => new Set((query.data?.tags ?? []).map((tg) => tg.name)), [query.data])

  const addMutation = useMutation({
    mutationFn: (name: string) => api.post(`/conversations/${conversationId}/tags`, { tag: name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })
  const removeMutation = useMutation({
    mutationFn: (name: string) => api.del(`/conversations/${conversationId}/tags/${encodeURIComponent(name)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  })

  const pending = addMutation.isPending || removeMutation.isPending

  function toggle(name: string) {
    if (pending) return
    if (active.has(name)) removeMutation.mutate(name)
    else addMutation.mutate(name)
  }

  return (
    <section className="border-b border-gray-200 p-3 dark:border-gray-800">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('tags.title')}</h3>

      {query.isLoading ? (
        <p className="text-xs text-gray-400">{t('common.loading')}</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {TAG_TYPES.map((tt) => {
            const on = active.has(tt.name)
            return (
              <button
                key={tt.name}
                type="button"
                onClick={() => toggle(tt.name)}
                disabled={pending}
                className={`rounded-full border px-2 py-0.5 text-xs transition disabled:opacity-50 ${
                  on ? 'border-transparent text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
                style={on ? { backgroundColor: tagColor(tt.name) } : undefined}
              >
                {tagLabel(tt.name, language)}
              </button>
            )
          })}
        </div>
      )}
      {!query.isLoading && active.size === 0 && <p className="mt-2 text-xs text-gray-400">{t('tags.empty')}</p>}
    </section>
  )
}
