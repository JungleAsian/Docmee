'use client'

// Admin Studio — Doctor management (Req 30, Gap #32). Pick a clinic, then list / add /
// edit / delete its doctors. Each doctor can carry their own Google Calendar
// credentials (so the booking flow checks and books against that doctor's calendar)
// AND their own weekly working hours (so the bot only offers slots when that doctor
// actually works).
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, API_BASE, ApiError } from '@/shared/api/client'
import { ClinicSelect } from '@/shared/components/ClinicSelect'
import { PillToggle } from '@/shared/components/PillToggle'
import {
  WEEKDAYS,
  addShift,
  removeShift,
  setDayEnabled,
  setShift,
} from '@/shared/doctorHours'
import { useI18n } from '@/shared/hooks/useI18n'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import type { Doctor, DoctorAvailability, Service } from '@/shared/types'

export default function DoctorsPage() {
  const { t } = useI18n()
  const { clinicId, switchClinic } = useActiveClinic()
  const qc = useQueryClient()

  const key = ['doctors', clinicId]
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ doctors: Doctor[] }>(`/clinics/${clinicId}/doctors`),
  })

  const doctors = query.data?.doctors ?? []

  // Post-OAuth redirect banner from /clinics/:id/doctors/:doctorId/calendar/auth.
  // Client-side query-param read avoids a useSearchParams Suspense requirement
  // on this page (same convention as the workflows page's deep-link handling).
  const [calendarBanner, setCalendarBanner] = useState<{ kind: 'connected' | 'error'; doctorId?: string } | null>(null)
  const bannerHandledRef = useRef(false)
  useEffect(() => {
    if (bannerHandledRef.current) return
    const params = new URLSearchParams(window.location.search)
    const calendar = params.get('calendar')
    if (calendar !== 'connected' && calendar !== 'error') return
    bannerHandledRef.current = true
    setCalendarBanner({ kind: calendar, doctorId: params.get('doctor') ?? undefined })
    window.history.replaceState(null, '', window.location.pathname)
    qc.invalidateQueries({ queryKey: ['doctors', clinicId] })
  }, [clinicId, qc])

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t('studio.doctors.title')}</h1>
        <ClinicSelect value={clinicId} onChange={switchClinic} label={t('analytics.selectClinic')} />
      </div>

      {calendarBanner && (
        <div
          className={
            calendarBanner.kind === 'connected'
              ? 'rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300'
              : 'rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300'
          }
        >
          {calendarBanner.kind === 'connected'
            ? t('studio.doctors.calendarConnectedBanner')
            : t('studio.doctors.calendarErrorBanner')}
        </div>
      )}

      {!clinicId ? (
        <p className="text-sm text-gray-400">{t('studio.doctors.selectClinic')}</p>
      ) : (
        <>
          <ClinicServicesPanel clinicId={clinicId} />

          <NewDoctorForm clinicId={clinicId} />

          <DataPortabilityPanel clinicId={clinicId} doctors={doctors} />

          {query.isLoading ? (
            <p className="text-sm text-gray-400">{t('common.loading')}</p>
          ) : doctors.length === 0 ? (
            <p className="text-sm text-gray-400">{t('studio.doctors.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {doctors.map((doc) => (
                <DoctorRow key={doc.id} clinicId={clinicId} doctor={doc} />
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}

const field =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800'

function csvEscape(value: string | number | null | undefined): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"'
      i += 1
    } else if (ch === '"') {
      quoted = !quoted
    } else if (ch === ',' && !quoted) {
      cells.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  cells.push(cur.trim())
  return cells
}

function parseRows(raw: string): string[][] {
  const rows = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(parseCsvLine)
  const first = rows[0] ?? []
  const hasHeader = first.some((cell) => /^(name|nombre|doctor|service|servicio)$/i.test(cell))
  return rows.slice(hasHeader ? 1 : 0)
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function DataPortabilityPanel({ clinicId, doctors }: { clinicId: string; doctors: Doctor[] }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [doctorCsv, setDoctorCsv] = useState('')
  const [serviceCsv, setServiceCsv] = useState('')
  const [result, setResult] = useState<string | null>(null)

  const servicesQuery = useQuery({
    queryKey: ['services', clinicId],
    queryFn: () => api.get<{ services: Service[] }>(`/clinics/${clinicId}/services`),
  })
  const services = servicesQuery.data?.services ?? []

  async function loadImportFile(file: File | undefined, setValue: (value: string) => void) {
    if (!file) return
    setValue(await file.text())
  }

  const doctorImport = useMutation({
    mutationFn: async () => {
      const existing = new Set(doctors.map((d) => d.name.trim().toLowerCase()))
      const rows = parseRows(doctorCsv)
      let imported = 0
      let skipped = 0
      for (const [name, specialty] of rows) {
        const clean = (name ?? '').trim()
        if (!clean || existing.has(clean.toLowerCase())) {
          skipped += 1
          continue
        }
        await api.post(`/clinics/${clinicId}/doctors`, {
          name: clean,
          specialty: specialty?.trim() || undefined,
          availableDays: {},
        })
        existing.add(clean.toLowerCase())
        imported += 1
      }
      return { imported, skipped }
    },
    onSuccess: ({ imported, skipped }) => {
      setDoctorCsv('')
      setResult(t('studio.importExport.result', { imported, skipped }))
      qc.invalidateQueries({ queryKey: ['doctors', clinicId] })
    },
    onError: () => setResult(t('studio.importExport.error')),
  })

  const serviceImport = useMutation({
    mutationFn: async () => {
      const existing = new Set(services.map((s) => s.name.trim().toLowerCase()))
      const rows = parseRows(serviceCsv)
      let imported = 0
      let skipped = 0
      for (const [name, duration] of rows) {
        const clean = (name ?? '').trim()
        const minutes = Number(duration)
        if (!clean || existing.has(clean.toLowerCase()) || !Number.isFinite(minutes) || minutes < 1) {
          skipped += 1
          continue
        }
        await api.post(`/clinics/${clinicId}/services`, {
          name: clean,
          durationMinutes: Math.min(480, Math.round(minutes)),
        })
        existing.add(clean.toLowerCase())
        imported += 1
      }
      return { imported, skipped }
    },
    onSuccess: ({ imported, skipped }) => {
      setServiceCsv('')
      setResult(t('studio.importExport.result', { imported, skipped }))
      qc.invalidateQueries({ queryKey: ['services', clinicId] })
    },
    onError: () => setResult(t('studio.importExport.error')),
  })

  return (
    <section className="clinic-card mb-6 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('studio.importExport.title')}</h2>
          <p className="mt-0.5 text-xs text-gray-400">{t('studio.importExport.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              downloadCsv(`doctors-${clinicId}.csv`, [
                ['name', 'specialty', 'active', 'calendar_connected'],
                ...doctors.map((d) => [d.name, d.specialty ?? '', d.isActive ? 'yes' : 'no', d.calendarConnected ? 'yes' : 'no']),
              ])
            }
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('studio.importExport.exportDoctors')}
          </button>
          <button
            type="button"
            onClick={() =>
              downloadCsv(`services-${clinicId}.csv`, [
                ['name', 'duration_minutes', 'price', 'currency'],
                ...services.map((s) => [s.name, s.durationMinutes, s.price ?? '', s.currency ?? '']),
              ])
            }
            className="rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('studio.importExport.exportServices')}
          </button>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-2 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            <span>Upload doctors CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => loadImportFile(e.target.files?.[0], setDoctorCsv)}
            />
          </label>
          <textarea
            value={doctorCsv}
            onChange={(e) => setDoctorCsv(e.target.value)}
            rows={4}
            placeholder={t('studio.importExport.doctorPlaceholder')}
            className={field}
          />
          <button
            type="button"
            onClick={() => doctorImport.mutate()}
            disabled={doctorImport.isPending || !doctorCsv.trim()}
            className="mt-2 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {t('studio.importExport.importDoctors')}
          </button>
        </div>
        <div>
          <label className="mb-2 flex min-h-11 cursor-pointer items-center justify-between gap-3 rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800">
            <span>Upload services CSV</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(e) => loadImportFile(e.target.files?.[0], setServiceCsv)}
            />
          </label>
          <textarea
            value={serviceCsv}
            onChange={(e) => setServiceCsv(e.target.value)}
            rows={4}
            placeholder={t('studio.importExport.servicePlaceholder')}
            className={field}
          />
          <button
            type="button"
            onClick={() => serviceImport.mutate()}
            disabled={serviceImport.isPending || !serviceCsv.trim()}
            className="mt-2 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {t('studio.importExport.importServices')}
          </button>
        </div>
      </div>
      {result && <p className="mt-2 text-xs text-gray-500">{result}</p>}
    </section>
  )
}

/** Human summary of a doctor's working hours, e.g. "Mon, Tue, Fri". */
function hoursSummary(availability: DoctorAvailability, t: (k: string) => string): string {
  const days = WEEKDAYS.filter((d) => (availability[d]?.length ?? 0) > 0)
  if (days.length === 0) return t('studio.doctors.noHours')
  return days.map((d) => t(`studio.doctors.day.${d}`)).join(', ')
}

function DoctorRow({ clinicId, doctor }: { clinicId: string; doctor: Doctor }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [showServices, setShowServices] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => api.del(`/clinics/${clinicId}/doctors/${doctor.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctors', clinicId] }),
  })

  if (editing) {
    return (
      <li className="rounded-lg border border-teal-200 bg-white p-3 dark:border-teal-900 dark:bg-gray-900">
        <EditDoctorForm clinicId={clinicId} doctor={doctor} onDone={() => setEditing(false)} />
      </li>
    )
  }

  return (
    <li className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">
            {doctor.name}
            {!doctor.isActive && (
              <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                {t('studio.doctors.inactive')}
              </span>
            )}
          </p>
          {doctor.specialty && <p className="text-xs text-gray-500">{doctor.specialty}</p>}
          <p className="mt-1 text-xs text-gray-500">
            {t('studio.doctors.hours')}: {hoursSummary(doctor.availableDays, t)}
          </p>
          <p className="mt-1 text-xs">
            <span
              className={
                doctor.calendarConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'
              }
            >
              {doctor.calendarConnected ? t('studio.doctors.connected') : t('studio.doctors.notConnected')}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={() => setShowServices((s) => !s)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('studio.doctors.manageServices')}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
          >
            {t('common.edit')}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(t('studio.doctors.deleteConfirm'))) deleteMutation.mutate()
            }}
            className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
          >
            {t('common.delete')}
          </button>
        </div>
      </div>

      {showServices && <DoctorServicesEditor clinicId={clinicId} doctorId={doctor.id} />}
    </li>
  )
}

/**
 * Per-doctor service assignment. Lists every clinic service as a checkbox; the
 * doctor's currently-assigned services are checked. Toggling assigns (POST) or
 * unassigns (DELETE) against /clinics/:id/doctors/:doctorId/services.
 */
function DoctorServicesEditor({ clinicId, doctorId }: { clinicId: string; doctorId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()

  const clinicServices = useQuery({
    queryKey: ['services', clinicId],
    queryFn: () => api.get<{ services: Service[] }>(`/clinics/${clinicId}/services`),
  })
  const assignedKey = ['doctor-services', clinicId, doctorId]
  const assigned = useQuery({
    queryKey: assignedKey,
    queryFn: () =>
      api.get<{ services: Service[] }>(`/clinics/${clinicId}/doctors/${doctorId}/services`),
  })

  const toggle = useMutation({
    mutationFn: ({ serviceId, on }: { serviceId: string; on: boolean }) =>
      on
        ? api.post(`/clinics/${clinicId}/doctors/${doctorId}/services`, { serviceId })
        : api.del(`/clinics/${clinicId}/doctors/${doctorId}/services/${serviceId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: assignedKey }),
  })

  const services = clinicServices.data?.services ?? []
  const assignedIds = new Set((assigned.data?.services ?? []).map((s) => s.id))

  return (
    <div className="mt-3 rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <p className="text-xs font-medium text-gray-500">{t('studio.doctors.services')}</p>
      <p className="mt-0.5 text-xs text-gray-400">{t('studio.doctors.servicesHint')}</p>
      {clinicServices.isLoading || assigned.isLoading ? (
        <p className="mt-2 text-xs text-gray-400">{t('common.loading')}</p>
      ) : services.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">{t('studio.doctors.noClinicServices')}</p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {services.map((s) => (
            <label
              key={s.id}
              className="flex min-h-11 items-center gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800"
            >
              <span>{s.name}</span>
              <span className="text-xs text-gray-400">
                {s.durationMinutes} {t('studio.services.minutes')}
              </span>
              <span className="ml-auto">
                <PillToggle
                  checked={assignedIds.has(s.id)}
                  disabled={toggle.isPending}
                  label={s.name}
                  onChange={(on) => toggle.mutate({ serviceId: s.id, on })}
                  size="sm"
                />
              </span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

/** Clinic-wide service catalogue: list existing services and add new ones. */
function ClinicServicesPanel({ clinicId }: { clinicId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [duration, setDuration] = useState('30')
  const [error, setError] = useState<string | null>(null)

  const query = useQuery({
    queryKey: ['services', clinicId],
    queryFn: () => api.get<{ services: Service[] }>(`/clinics/${clinicId}/services`),
  })

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/clinics/${clinicId}/services`, {
        name: name.trim(),
        durationMinutes: Number(duration) || undefined,
      }),
    onSuccess: () => {
      setName('')
      setDuration('30')
      setError(null)
      qc.invalidateQueries({ queryKey: ['services', clinicId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  })

  const services = query.data?.services ?? []

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) mutation.mutate()
  }

  return (
    <section className="clinic-card mb-6 p-3">
      <h2 className="text-sm font-semibold">{t('studio.services.title')}</h2>
      <p className="mt-0.5 text-xs text-gray-400">{t('studio.services.hint')}</p>

      <form onSubmit={onSubmit} className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('studio.services.name')}
          className={field}
        />
        <input
          type="number"
          min={1}
          max={480}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          placeholder={t('studio.services.duration')}
          className="rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !name.trim()}
          className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {t('studio.services.add')}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {query.isLoading ? (
        <p className="mt-3 text-xs text-gray-400">{t('common.loading')}</p>
      ) : services.length === 0 ? (
        <p className="mt-3 text-xs text-gray-400">{t('studio.services.empty')}</p>
      ) : (
        <ul className="mt-3 flex flex-wrap gap-2">
          {services.map((s) => (
            <li
              key={s.id}
              className="rounded-full border border-gray-200 px-2.5 py-1 text-xs dark:border-gray-700"
            >
              {s.name}
              <span className="ml-1 text-gray-400">
                · {s.durationMinutes} {t('studio.services.minutes')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * A 7-row weekly hours editor supporting SPLIT SHIFTS: each enabled day can hold
 * one or more start/end ranges (e.g. a morning + an afternoon block around a lunch
 * break). Unchecked = day off. All edits go through the pure doctorHours helpers.
 */
function WeeklyHoursEditor({
  value,
  onChange,
}: {
  value: DoctorAvailability
  onChange: (next: DoctorAvailability) => void
}) {
  const { t } = useI18n()
  const activeDays = WEEKDAYS.filter((day) => (value[day] ?? []).length > 0).length
  const totalShifts = WEEKDAYS.reduce((total, day) => total + (value[day] ?? []).length, 0)

  return (
    <div className="rounded-md border border-gray-200 p-3 dark:border-gray-700">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">{t('studio.doctors.workingHours')}</p>
          <p className="mt-1 text-xs text-gray-400">{t('studio.doctors.hoursHint')}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-gray-500 dark:text-gray-300">
          <span className="rounded-full border border-gray-200 px-2.5 py-1 dark:border-gray-800">{activeDays}/7 days</span>
          <span className="rounded-full border border-gray-200 px-2.5 py-1 dark:border-gray-800">{totalShifts} shift{totalShifts === 1 ? '' : 's'}</span>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {WEEKDAYS.map((day) => {
          const shifts = value[day] ?? []
          const enabled = shifts.length > 0
          return (
            <div
              key={day}
              className={`rounded-lg border p-3 ${
                enabled
                  ? 'border-cyan-300 bg-white shadow-sm ring-1 ring-cyan-100 dark:border-cyan-500/40 dark:bg-cyan-950/20 dark:ring-cyan-500/10'
                  : 'border-gray-200 bg-white/40 dark:border-gray-800 dark:bg-gray-950/20'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <label
                  className={`flex min-h-9 flex-1 items-center gap-2 text-sm font-semibold ${
                    enabled ? 'text-cyan-900 dark:text-cyan-100' : 'text-gray-700 dark:text-gray-100'
                  }`}
                >
                  <span className="truncate">{t(`studio.doctors.day.${day}`)}</span>
                  <PillToggle
                    checked={enabled}
                    label={t(`studio.doctors.day.${day}`)}
                    onChange={(checked) => onChange(setDayEnabled(value, day, checked))}
                    size="sm"
                    className="ml-auto"
                  />
                </label>
              </div>
              {enabled ? (
                <div className="mt-3 space-y-2">
                  {shifts.map((range, i) => (
                    <div key={i} className="grid grid-cols-[1fr_auto_1fr_2rem] items-center gap-1.5 text-sm">
                      <input
                        type="time"
                        value={range.start}
                        onChange={(e) => onChange(setShift(value, day, i, { start: e.target.value }))}
                        className="min-w-0 rounded-md border border-cyan-100 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 dark:border-cyan-800/60 dark:bg-gray-950/70 dark:text-gray-100 dark:focus:ring-cyan-900/40"
                      />
                      <span className="text-xs font-semibold text-gray-500 dark:text-gray-300">to</span>
                      <input
                        type="time"
                        value={range.end}
                        onChange={(e) => onChange(setShift(value, day, i, { end: e.target.value }))}
                        className="min-w-0 rounded-md border border-cyan-100 bg-white px-2 py-1.5 text-xs font-semibold text-gray-800 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-100 dark:border-cyan-800/60 dark:bg-gray-950/70 dark:text-gray-100 dark:focus:ring-cyan-900/40"
                      />
                      <button
                        type="button"
                        onClick={() => onChange(removeShift(value, day, i))}
                        aria-label={t('studio.doctors.removeShift')}
                        title={t('studio.doctors.removeShift')}
                        className="rounded-md border border-red-200 px-2 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
                      >
                        X
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => onChange(addShift(value, day))}
                    className="w-full rounded-md border border-dashed border-cyan-300 bg-cyan-50/70 px-3 py-2 text-xs font-semibold text-cyan-800 hover:bg-cyan-100 dark:border-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-100 dark:hover:bg-cyan-950/60"
                  >
                    + {t('studio.doctors.addShift')}
                  </button>
                </div>
              ) : (
                <div className="mt-3 rounded-md border border-dashed border-gray-200 px-3 py-3 text-center text-xs text-gray-400 dark:border-gray-800">
                  {t('studio.doctors.dayOff')}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NewDoctorForm({ clinicId }: { clinicId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [specialty, setSpecialty] = useState('')
  const [availableDays, setAvailableDays] = useState<DoctorAvailability>({})
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/clinics/${clinicId}/doctors`, {
        name,
        specialty: specialty || undefined,
        availableDays,
      }),
    onSuccess: () => {
      setName('')
      setSpecialty('')
      setAvailableDays({})
      setError(null)
      qc.invalidateQueries({ queryKey: ['doctors', clinicId] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : t('common.error')),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) mutation.mutate()
  }

  return (
    <form
      onSubmit={onSubmit}
      className="clinic-card mb-6 grid grid-cols-1 gap-2 p-3 sm:grid-cols-2"
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('studio.doctors.name')} className={field} />
      <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder={t('studio.doctors.specialty')} className={field} />
      <p className="text-xs text-gray-500 sm:col-span-2">{t('studio.doctors.calendarConnectSaveFirst')}</p>
      <div className="sm:col-span-2">
        <WeeklyHoursEditor value={availableDays} onChange={setAvailableDays} />
      </div>
      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={mutation.isPending || !name.trim()}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {t('studio.doctors.add')}
        </button>
      </div>
      {error && <p className="text-xs text-red-600 sm:col-span-2">{error}</p>}
    </form>
  )
}

function EditDoctorForm({
  clinicId,
  doctor,
  onDone,
}: {
  clinicId: string
  doctor: Doctor
  onDone: () => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [name, setName] = useState(doctor.name)
  const [specialty, setSpecialty] = useState(doctor.specialty ?? '')
  const [isActive, setIsActive] = useState(doctor.isActive)
  const [availableDays, setAvailableDays] = useState<DoctorAvailability>(doctor.availableDays ?? {})
  const [disconnectMessage, setDisconnectMessage] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/clinics/${clinicId}/doctors/${doctor.id}`, {
        name,
        specialty: specialty || undefined,
        availableDays,
        isActive,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doctors', clinicId] })
      onDone()
    },
  })

  const disconnectCalendar = useMutation({
    mutationFn: () => api.del(`/clinics/${clinicId}/doctors/${doctor.id}/calendar/disconnect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doctors', clinicId] }),
    onError: (e) => setDisconnectMessage(e instanceof ApiError ? e.message : t('common.error')),
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (name.trim()) mutation.mutate()
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('studio.doctors.name')} className={field} />
      <input value={specialty} onChange={(e) => setSpecialty(e.target.value)} placeholder={t('studio.doctors.specialty')} className={field} />
      <label className="flex min-h-11 items-center gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800">
        <span>{t('studio.doctors.active')}</span>
        <PillToggle
          checked={isActive}
          label={t('studio.doctors.active')}
          onChange={setIsActive}
          className="ml-auto"
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-gray-200 p-3 text-xs dark:border-gray-800 sm:col-span-2">
        <span className={doctor.calendarConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}>
          {doctor.calendarConnected ? t('studio.doctors.connected') : t('studio.doctors.notConnected')}
        </span>
        {doctor.calendarConnected ? (
          <button
            type="button"
            onClick={() => disconnectCalendar.mutate()}
            disabled={disconnectCalendar.isPending}
            className="ml-auto rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 disabled:opacity-50 dark:border-red-900 dark:text-red-300"
          >
            {disconnectCalendar.isPending ? t('common.loading') : t('studio.doctors.calendarDisconnect')}
          </button>
        ) : (
          <a
            href={`${API_BASE}/clinics/${clinicId}/doctors/${doctor.id}/calendar/auth`}
            className="ml-auto rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-700"
          >
            {t('studio.doctors.calendarConnect')}
          </a>
        )}
        {disconnectMessage && <p className="w-full text-red-600">{disconnectMessage}</p>}
      </div>
      <div className="sm:col-span-2">
        <WeeklyHoursEditor value={availableDays} onChange={setAvailableDays} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button
          type="submit"
          disabled={mutation.isPending || !name.trim()}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {t('common.save')}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}
