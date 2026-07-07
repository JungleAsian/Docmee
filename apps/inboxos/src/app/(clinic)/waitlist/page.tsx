'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { useAuthGuard } from '@/shared/hooks/useAuthGuard'
import { rolesWith } from '@/shared/permissions'

type WaitlistStatus = 'active' | 'notified' | 'booked' | 'expired' | 'cancelled'

interface WaitlistEntry {
  id: string
  status: WaitlistStatus
  desired_from: string | null
  desired_to: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

const STATUSES: Array<'all' | WaitlistStatus> = ['all', 'active', 'notified', 'booked', 'expired', 'cancelled']

export default function WaitlistPage() {
  const { ready } = useAuthGuard(rolesWith('calendar'))
  const { clinicId } = useActiveClinic()
  const qc = useQueryClient()
  const [status, setStatus] = useState<'all' | WaitlistStatus>('active')
  const [patientName, setPatientName] = useState('')
  const [phone, setPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [desiredFrom, setDesiredFrom] = useState('')

  const query = useQuery({
    queryKey: ['waitlist', clinicId, status],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ entries: WaitlistEntry[] }>(`/clinics/${clinicId}/waitlist${status === 'all' ? '' : `?status=${status}`}`),
  })
  const entries = useMemo(() => query.data?.entries ?? [], [query.data])

  const createMutation = useMutation({
    mutationFn: () =>
      api.post(`/clinics/${clinicId}/waitlist`, {
        desiredFrom: desiredFrom ? new Date(desiredFrom).toISOString() : undefined,
        metadata: { patientName, phone, notes },
      }),
    onSuccess: () => {
      setPatientName('')
      setPhone('')
      setNotes('')
      setDesiredFrom('')
      qc.invalidateQueries({ queryKey: ['waitlist', clinicId] })
    },
  })
  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: string; next: WaitlistStatus }) =>
      api.patch(`/clinics/${clinicId}/waitlist/${id}`, { status: next }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['waitlist', clinicId] }),
  })

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!patientName.trim()) return
    createMutation.mutate()
  }

  if (!ready) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-400">Loading...</div>
  }

  return (
    <div className="clinic-page clinic-page-md space-y-5">
      <div className="clinic-page-header">
        <div>
          <p className="clinic-eyebrow">Scheduling recovery</p>
          <h1 className="clinic-title">Waitlist</h1>
          <p className="clinic-subtitle">Track patients who want earlier or alternative appointment slots.</p>
        </div>
        <button
          type="button"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-semibold shadow-sm hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800"
        >
          Refresh
        </button>
      </div>

      <form onSubmit={onSubmit} className="clinic-card grid gap-3 p-4 md:grid-cols-5">
        <input
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          placeholder="Patient name"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone or WhatsApp"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <input
          type="datetime-local"
          value={desiredFrom}
          onChange={(e) => setDesiredFrom(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Preference or note"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <button
          type="submit"
          disabled={createMutation.isPending || !patientName.trim()}
          className="rounded-md bg-teal-600 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          Add
        </button>
      </form>

      <div className="clinic-toolbar">
        {STATUSES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setStatus(item)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${status === item ? 'bg-teal-600 text-white' : 'border border-gray-300 text-gray-600 dark:border-gray-700 dark:text-gray-300'}`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="clinic-card divide-y divide-gray-100 overflow-hidden dark:divide-gray-800">
        {query.isLoading ? (
          <p className="p-5 text-sm text-gray-400">Loading waitlist...</p>
        ) : entries.length === 0 ? (
          <p className="p-5 text-sm text-gray-400">No waitlist entries in this view.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{String(entry.metadata.patientName ?? 'Unnamed patient')}</p>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-gray-500 dark:bg-gray-800">
                    {entry.status}
                  </span>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {String(entry.metadata.phone ?? '')}
                  {entry.desired_from ? ` · Desired ${new Date(entry.desired_from).toLocaleString()}` : ''}
                </p>
                {entry.metadata.notes ? <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{String(entry.metadata.notes)}</p> : null}
              </div>
              <select
                value={entry.status}
                onChange={(e) => statusMutation.mutate({ id: entry.id, next: e.target.value as WaitlistStatus })}
                disabled={statusMutation.isPending}
                className="rounded-md border border-gray-300 px-2 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                {STATUSES.filter((item): item is WaitlistStatus => item !== 'all').map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
