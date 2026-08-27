'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Clinic } from '../types'

const ITEMS = [
  ['safetyHandoff', 'Safety and hand-off'], ['lifecycleStatus', 'Life cycle status'], ['tags', 'Tags'],
  ['aiAssistance', 'AI information'], ['inactiveChannels', 'Inactive channels'], ['assignee', 'Conversation assignee'],
] as const

export function InboxDisplaySettingsPanel({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient(); const current = (clinic.settings ?? {}) as Record<string, unknown>
  const visibility = (current.patientChatVisibility && typeof current.patientChatVisibility === 'object' ? current.patientChatVisibility : {}) as Record<string, unknown>
  const [draft, setDraft] = useState<Record<string, boolean>>(() => Object.fromEntries(ITEMS.map(([key]) => [key, visibility[key] !== false])))
  const [tags, setTags] = useState<string[]>(() => Array.isArray(current.inboxTags) ? current.inboxTags.filter((x): x is string => typeof x === 'string') : [])
  const [newTag, setNewTag] = useState('')
  useEffect(() => { setDraft(Object.fromEntries(ITEMS.map(([key]) => [key, visibility[key] !== false]))); setTags(Array.isArray(current.inboxTags) ? current.inboxTags.filter((x): x is string => typeof x === 'string') : []) }, [clinic.id, clinic.settings])
  const save = useMutation({ mutationFn: () => api.patch(`/clinics/${clinic.id}`, { settings: { ...current, patientChatVisibility: { ...(current.patientChatVisibility as object ?? {}), ...draft }, inboxTags: tags } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic', clinic.id] }) })
  return <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900"><h2 className="text-sm font-semibold">InboxOS display</h2><p className="mt-1 text-xs text-gray-500">Choose which context sections secretaries see. Changes apply to the InboxOS rail.</p><div className="mt-3 grid gap-2 sm:grid-cols-2">{ITEMS.map(([key, label]) => <label key={key} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft[key] !== false} onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.checked }))} />{label}</label>)}</div><div className="mt-4"><p className="text-xs font-semibold">Custom conversation tags</p><div className="mt-2 flex flex-wrap gap-1">{tags.map((tag) => <button key={tag} type="button" onClick={() => setTags((old) => old.filter((value) => value !== tag))} className="rounded-full bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800">{tag} ×</button>)}</div><div className="mt-2 flex gap-2"><input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="e.g. Insurance" className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800" /><button type="button" onClick={() => { const tag = newTag.trim(); if (tag && !tags.includes(tag)) setTags((old) => [...old, tag]); setNewTag('') }} className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold dark:bg-gray-800">Add tag</button></div></div><button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="mt-4 rounded bg-teal-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{save.isPending ? 'Saving…' : 'Save InboxOS settings'}</button>{save.isSuccess && <span className="ml-2 text-xs text-emerald-600">Saved</span>}</section>
}
