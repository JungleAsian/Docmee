'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { readInboxSettings } from '../inboxSettings'
import type { Clinic } from '../types'

const ITEMS = [
  ['safetyHandoff', 'Safety and hand-off'], ['lifecycleStatus', 'Life cycle status'], ['tags', 'Tags'],
  ['aiAssistance', 'AI information'], ['inactiveChannels', 'Show inactive channels'], ['assignee', 'Conversation assignee'],
  ['assignControls', 'Assign controls'], ['patientHistory', 'Patient history'], ['chatStatus', 'Chat status'],
  ['nextAppointment', 'Next appointment'], ['appointmentDateTime', 'Appointment date and time'],
  ['headerNextAppointment', 'Header next appointment'], ['headerPatientHistory', 'Header patient history'],
  ['headerStatusSelector', 'Header status selector'], ['headerResolveAction', 'Header resolve button'],
] as const

export function InboxDisplaySettingsPanel({ clinic }: { clinic: Clinic }) {
  const qc = useQueryClient(); const current = (clinic.settings ?? {}) as Record<string, unknown>
  const resolvedVisibility = readInboxSettings(current).patientChatVisibility
  const [draft, setDraft] = useState<Record<string, boolean>>(() => Object.fromEntries(ITEMS.map(([key]) => [key, resolvedVisibility[key]])))
  type TagDefinition = { name: string; color: string; archived: boolean }
  const initialTags = Array.isArray(current.inboxTags) ? current.inboxTags.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []
  const initialDefinitions = Array.isArray(current.inboxTagDefinitions)
    ? current.inboxTagDefinitions.filter((x): x is TagDefinition => Boolean(x) && typeof x === 'object' && typeof (x as TagDefinition).name === 'string').map((x) => ({ name: x.name.trim(), color: typeof x.color === 'string' ? x.color : '#64748b', archived: x.archived === true }))
    : initialTags.map((name) => ({ name, color: '#64748b', archived: false }))
  const [tags, setTags] = useState<TagDefinition[]>(initialDefinitions)
  const [newTag, setNewTag] = useState('')
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const defs = Array.isArray(current.inboxTagDefinitions)
      ? current.inboxTagDefinitions
        .filter((x): x is TagDefinition => Boolean(x) && typeof x === 'object' && typeof (x as TagDefinition).name === 'string')
        .map((x) => ({ name: x.name.trim(), color: typeof x.color === 'string' ? x.color : '#64748b', archived: x.archived === true }))
      : (Array.isArray(current.inboxTags)
          ? current.inboxTags
            .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
            .map((name) => ({ name, color: '#64748b', archived: false }))
          : [])
    const nextVisibility = readInboxSettings(current).patientChatVisibility
    setDraft(Object.fromEntries(ITEMS.map(([key]) => [key, nextVisibility[key]])))
    setTags(defs)
  }, [clinic.id, clinic.settings])
  const save = useMutation({ mutationFn: () => api.patch(`/clinics/${clinic.id}`, { settings: { ...current, patientChatVisibility: { ...(current.patientChatVisibility as object ?? {}), ...draft }, inboxTags: tags.filter((tag) => !tag.archived).map((tag) => tag.name), inboxTagDefinitions: tags } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic', clinic.id] }) })
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">InboxOS display</h2>
          <p className="mt-1 text-xs text-gray-500">
            Choose which context sections secretaries see. Changes apply to the InboxOS rail.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-expanded={revealed}
          aria-controls="inbox-display-settings"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          {revealed ? 'Hide settings' : 'Show settings'}
        </button>
      </div>

      {revealed && (
        <div id="inbox-display-settings">
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {ITEMS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={draft[key] !== false}
                  onChange={(e) => setDraft((old) => ({ ...old, [key]: e.target.checked }))}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-4">
            <p className="text-xs font-semibold">Custom conversation tags</p>
            <div className="mt-2 space-y-2">
              {tags.map((tag, index) => (
                <div key={`${tag.name}-${index}`} className="flex items-center gap-2">
                  <input
                    value={tag.name}
                    onChange={(e) => setTags((old) => old.map((item, i) => i === index ? { ...item, name: e.target.value } : item))}
                    className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
                  />
                  <input
                    aria-label={`Color for ${tag.name}`}
                    type="color"
                    value={tag.color}
                    onChange={(e) => setTags((old) => old.map((item, i) => i === index ? { ...item, color: e.target.value } : item))}
                    className="h-7 w-8 rounded border-0 bg-transparent p-0"
                  />
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={tag.archived}
                      onChange={(e) => setTags((old) => old.map((item, i) => i === index ? { ...item, archived: e.target.checked } : item))}
                    />
                    Archive
                  </label>
                  <button
                    type="button"
                    aria-label={`Move ${tag.name} up`}
                    disabled={index === 0}
                    onClick={() => setTags((old) => { const next = [...old]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next })}
                    className="px-1 text-xs disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${tag.name} down`}
                    disabled={index === tags.length - 1}
                    onClick={() => setTags((old) => { const next = [...old]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next })}
                    className="px-1 text-xs disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${tag.name}`}
                    onClick={() => setTags((old) => old.filter((_, i) => i !== index))}
                    className="px-1 text-xs text-red-600"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="e.g. Insurance"
                className="min-w-0 flex-1 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-gray-800"
              />
              <button
                type="button"
                onClick={() => { const name = newTag.trim(); if (name && !tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) setTags((old) => [...old, { name, color: '#64748b', archived: false }]); setNewTag('') }}
                className="rounded bg-gray-100 px-2 py-1 text-xs font-semibold dark:bg-gray-800"
              >
                Add tag
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="mt-4 rounded bg-teal-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save InboxOS settings'}
          </button>
          {save.isSuccess && <span className="ml-2 text-xs text-emerald-600">Saved</span>}
        </div>
      )}
    </section>
  )
}
