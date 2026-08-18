'use client'

// Item 17 of the 25-item batch: "Recent Activity" as its own page with a table of
// all activity, reachable from a new "Activities" side-rail entry. Reuses the
// existing audit-events data/endpoint unchanged (same table, same source) — only
// the route and nav entry are new; /studio/audit now redirects here.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/shared/api/client'
import { formatDateTime } from '@/shared/format'
import { useI18n } from '@/shared/hooks/useI18n'

type Clinic = { id: string; name: string }
type AuditEvent = {
  id: string
  actorEmail: string | null
  action: string
  resourceType: string
  resourceId: string | null
  metadata: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
}

function formatDetailLabel(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isSensitiveDetail(key: string) {
  return /secret|token|password|credential|private|apikey|api key|key/i.test(key)
}

function formatDetailValue(key: string, value: unknown): string {
  if (isSensitiveDetail(key)) return '********'
  if (value == null || value === '') return 'Not set'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.length > 90 ? `${value.slice(0, 90)}...` : value
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (typeof value === 'object') return 'Updated settings'
  return String(value)
}

function DetailList({ details }: { details?: Record<string, unknown> | null }) {
  const entries = Object.entries(details ?? {})
  if (!entries.length) return <span className="text-gray-400">No extra details</span>
  return (
    <dl className="grid gap-1">
      {entries.slice(0, 4).map(([key, value]) => (
        <div key={key} className="flex min-w-0 items-start gap-2 rounded-md bg-gray-50 px-2 py-1 dark:bg-gray-900/60">
          <dt className="shrink-0 text-[10px] font-semibold uppercase text-gray-400">{formatDetailLabel(key)}</dt>
          <dd className="min-w-0 truncate text-xs text-gray-600 dark:text-gray-300">{formatDetailValue(key, value)}</dd>
        </div>
      ))}
      {entries.length > 4 && <dd className="text-[11px] text-gray-400">+{entries.length - 4} more detail{entries.length - 4 === 1 ? '' : 's'}</dd>}
    </dl>
  )
}

export default function ActivitiesPage() {
  const { language } = useI18n()
  const [clinicId, setClinicId] = useState('')
  const clinicsQuery = useQuery({
    queryKey: ['clinics'],
    queryFn: () => api.get<{ clinics: Clinic[] }>('/clinics'),
  })
  const activeClinicId = clinicId || clinicsQuery.data?.clinics[0]?.id || ''
  const auditQuery = useQuery({
    queryKey: ['audit-events', activeClinicId],
    enabled: Boolean(activeClinicId),
    queryFn: () => api.get<{ events: AuditEvent[] }>(`/clinics/${activeClinicId}/audit-events?limit=150`),
  })
  const clinics = clinicsQuery.data?.clinics ?? []
  const events = auditQuery.data?.events ?? []
  const selectedName = useMemo(() => clinics.find((c) => c.id === activeClinicId)?.name ?? 'Clinic', [activeClinicId, clinics])

  return (
    <div className="clinic-surface">
      <div className="clinic-page clinic-page-lg space-y-4">
        <div className="clinic-page-header">
          <div>
            <p className="clinic-eyebrow">Security and change history</p>
            <h1 className="clinic-title">Activities</h1>
            <p className="clinic-subtitle">Review clinic, credential, governance, role, and sensitive setting changes.</p>
          </div>
          <select
            value={activeClinicId}
            onChange={(event) => setClinicId(event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
          >
            {clinics.map((clinic) => (
              <option key={clinic.id} value={clinic.id}>{clinic.name}</option>
            ))}
          </select>
        </div>

        <section className="clinic-card overflow-hidden">
          <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold dark:border-gray-800">
            {selectedName} activity
          </div>
          {auditQuery.isLoading ? (
            <div className="p-6 text-sm text-gray-500">Loading activity...</div>
          ) : events.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">No activity recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500 dark:bg-gray-900">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Resource</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {events.map((event) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{formatDateTime(event.createdAt, language)}</td>
                      <td className="px-4 py-3">{event.actorEmail ?? 'System'}</td>
                      <td className="px-4 py-3 font-semibold">{event.action}</td>
                      <td className="px-4 py-3 text-gray-500">{event.resourceType}{event.resourceId ? `:${event.resourceId.slice(0, 8)}` : ''}</td>
                      <td className="max-w-md px-4 py-3 text-xs text-gray-500">
                        <DetailList details={event.metadata} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
