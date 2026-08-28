'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Clinic } from '../types'

type TagDefinition = { name: string; color: string; archived: boolean }

function tagDefinitions(settings: Record<string, unknown>): TagDefinition[] {
  const legacyTags = Array.isArray(settings.inboxTags)
    ? settings.inboxTags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
    : []
  return Array.isArray(settings.inboxTagDefinitions)
    ? settings.inboxTagDefinitions
      .filter((tag): tag is TagDefinition => Boolean(tag) && typeof tag === 'object' && typeof (tag as TagDefinition).name === 'string')
      .map((tag) => ({ name: tag.name.trim(), color: typeof tag.color === 'string' ? tag.color : '#64748b', archived: tag.archived === true }))
    : legacyTags.map((name) => ({ name, color: '#64748b', archived: false }))
}

/** Clinic-scoped conversation tag definitions, intentionally placed beside booking. */
export function CustomTagManager({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient()
  const settings = (clinic.settings ?? {}) as Record<string, unknown>
  const [tags, setTags] = useState<TagDefinition[]>(() => tagDefinitions(settings))
  const [newTag, setNewTag] = useState('')

  useEffect(() => {
    setTags(tagDefinitions((clinic.settings ?? {}) as Record<string, unknown>))
  }, [clinic.id, clinic.settings])

  const save = useMutation({
    mutationFn: () => api.patch(`/clinics/${clinic.id}`, {
      settings: {
        ...settings,
        inboxTags: tags.filter((tag) => !tag.archived).map((tag) => tag.name),
        inboxTagDefinitions: tags,
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic', clinic.id] }),
  })

  return (
    <section className="rounded-[var(--crm-border-radius-md)] border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] p-3 shadow-[var(--crm-shadow-sm)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Custom conversation tags</h3>
          <p className="mt-0.5 text-[11px] text-[var(--crm-text-muted)]">Manage the tags available for this clinic.</p>
        </div>
        {save.isSuccess && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
      <div className="mt-3 space-y-2">
        {tags.map((tag, index) => (
          <div key={`${tag.name}-${index}`} className="flex items-center gap-2">
            <input
              value={tag.name}
              onChange={(event) => setTags((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))}
              className="min-w-0 flex-1 rounded border border-[var(--crm-border-color)] bg-transparent px-2 py-1 text-xs"
            />
            <input
              aria-label={`Color for ${tag.name}`}
              type="color"
              value={tag.color}
              onChange={(event) => setTags((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, color: event.target.value } : item))}
              className="h-7 w-8 rounded border-0 bg-transparent p-0"
            />
            <label className="flex items-center gap-1 text-xs">
              <input
                type="checkbox"
                checked={tag.archived}
                onChange={(event) => setTags((old) => old.map((item, itemIndex) => itemIndex === index ? { ...item, archived: event.target.checked } : item))}
              />
              Archive
            </label>
            <button type="button" aria-label={`Move ${tag.name} up`} disabled={index === 0} onClick={() => setTags((old) => {
              const next = [...old]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next
            })} className="px-1 text-xs disabled:opacity-30">↑</button>
            <button type="button" aria-label={`Move ${tag.name} down`} disabled={index === tags.length - 1} onClick={() => setTags((old) => {
              const next = [...old]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next
            })} className="px-1 text-xs disabled:opacity-30">↓</button>
            <button type="button" aria-label={`Delete ${tag.name}`} onClick={() => setTags((old) => old.filter((_, itemIndex) => itemIndex !== index))} className="px-1 text-xs text-red-600">×</button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={newTag} onChange={(event) => setNewTag(event.target.value)} placeholder="e.g. Insurance" className="min-w-0 flex-1 rounded border border-[var(--crm-border-color)] bg-transparent px-2 py-1 text-xs" />
        <button type="button" onClick={() => {
          const name = newTag.trim()
          if (name && !tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) setTags((old) => [...old, { name, color: '#64748b', archived: false }])
          setNewTag('')
        }} className="rounded bg-[var(--crm-hover-bg)] px-2 py-1 text-xs font-semibold">Add tag</button>
      </div>
      <button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="mt-3 rounded bg-[var(--crm-primary-color)] px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
        {save.isPending ? 'Saving…' : 'Save tags'}
      </button>
    </section>
  )
}
