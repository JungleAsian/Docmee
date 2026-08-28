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
  const [revealed, setRevealed] = useState(false)
  useEffect(() => {
    const nextVisibility = readInboxSettings(current).patientChatVisibility
    setDraft(Object.fromEntries(ITEMS.map(([key]) => [key, nextVisibility[key]])))
  }, [clinic.id, clinic.settings])
  const save = useMutation({ mutationFn: () => api.patch(`/clinics/${clinic.id}`, { settings: { ...current, patientChatVisibility: { ...(current.patientChatVisibility as object ?? {}), ...draft } } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['clinic', clinic.id] }) })
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
