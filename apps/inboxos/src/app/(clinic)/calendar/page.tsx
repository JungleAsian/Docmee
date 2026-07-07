'use client'

// Screen 2 — AI booking & calendar (Req 9 slot picking, Req 30 multi-doctor).
//
// The operational day view of the appointments the AI books over WhatsApp, plus
// manual booking / rescheduling / cancellation by the secretary. It renders the
// approved mockup (tools/logs/mockups/screen-2.html): a per-doctor day GRID with
// hour lanes + appointment cards (source / urgency / status / assignee visually
// unmistakable), a right rail with free slots + an AI-activity feed, a chronological
// LIST view (and the mobile reflow), and a slot-picking booking slide-over. Explicit
// loading / error / empty / day-off / no-doctors / disconnected-calendar / success /
// permission-denied states throughout.
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/api/client'
import { useAuthGuard } from '@/shared/hooks/useAuthGuard'
import { useActiveClinic } from '@/shared/hooks/useActiveClinic'
import { rolesWith } from '@/shared/permissions'
import { useI18n } from '@/shared/hooks/useI18n'
import { SlideOver } from '@/shared/components/SlideOver'
import { TodayCommandCenter } from '@/shared/components/TodayCommandCenter'
import {
  buildDayAxis,
  formatRanges,
  isSplitShift,
  normalizeAvailability,
  rangesForDate,
} from '@/shared/calendarGrid'
import type {
  AppointmentEventFeedItem,
  AppointmentStatus,
  AppointmentWithNames,
  BookingPatient,
  Clinic,
  Doctor,
  Service,
  SlotsResponse,
} from '@/shared/types'

// ── Date helpers (UTC-based so the wall-clock date never drifts by host TZ) ──────
function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function isToday(date: string): boolean {
  return date === todayISO()
}
function formatDay(date: string, lang: 'es' | 'en'): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(lang === 'es' ? 'es-ES' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}
/** HH:MM portion of a stored ISO timestamp — the wall-clock the API booked. */
const timeOf = (iso: string): string => iso.slice(11, 16)
const minOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Up-to-2-letter initials from a name (for the doctor mini-avatar). */
function initials(name: string | null | undefined): string {
  if (!name) return '—'
  const cleaned = name.replace(/^(dr|dra|dr\.|dra\.)\s+/i, '').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

const field =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800'

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  confirmed: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  arrived: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  in_progress: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  cancelled: 'bg-gray-200 text-gray-500 line-through dark:bg-gray-800 dark:text-gray-400',
  completed: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  no_show: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
}

const TERMINAL_STATUSES: AppointmentStatus[] = ['cancelled', 'completed', 'no_show']
const APPT_LIFECYCLE: Array<{
  key: 'requested' | 'proposed' | AppointmentStatus
  status?: AppointmentStatus
}> = [
  { key: 'requested' },
  { key: 'proposed', status: 'pending' },
  { key: 'confirmed', status: 'confirmed' },
  { key: 'arrived', status: 'arrived' },
  { key: 'in_progress', status: 'in_progress' },
  { key: 'completed', status: 'completed' },
]

type ApptSource = 'ai' | 'staff'
const sourceOf = (a: AppointmentWithNames): ApptSource => (a.conversationId ? 'ai' : 'staff')
const isUrgent = (a: AppointmentWithNames): boolean =>
  Boolean((a.metadata as { urgent?: unknown } | undefined)?.urgent)

function StatusBadge({ status }: { status: AppointmentStatus }) {
  const { t } = useI18n()
  return (
    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${STATUS_STYLE[status]}`}>
      {t(`cal.status.${status}`)}
    </span>
  )
}

function SourceTag({ source }: { source: ApptSource }) {
  const { t } = useI18n()
  const ai = source === 'ai'
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
        ai
          ? 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300'
          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ai ? 'bg-teal-500' : 'bg-emerald-500'}`} />
      {ai ? t('cal.sourceAi') : t('cal.sourceStaff')}
    </span>
  )
}

function UrgentTag() {
  const { t } = useI18n()
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      {t('cal.urgent')}
    </span>
  )
}

function AppointmentLifecycleRail({ appt }: { appt: AppointmentWithNames }) {
  const { t } = useI18n()
  const currentIndex =
    appt.status === 'cancelled' || appt.status === 'no_show'
      ? -1
      : Math.max(
          0,
          APPT_LIFECYCLE.findIndex((step) => step.status === appt.status),
        )
  const terminal = TERMINAL_STATUSES.includes(appt.status)

  return (
    <div className="clinic-card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {t('cal.lifecycle.title')}
        </p>
        <span className="text-[11px] text-gray-400">
          {appt.status === 'cancelled'
            ? t('cal.lifecycle.cancelled')
            : appt.status === 'no_show'
              ? t('cal.lifecycle.noShow')
              : t('cal.lifecycle.active')}
        </span>
      </div>
      <ol className="space-y-2">
        {APPT_LIFECYCLE.map((step, index) => {
          const isCurrent = index === currentIndex && !terminal
          const isDone = !terminal && index < currentIndex
          return (
            <li key={step.key} className="flex items-center gap-2">
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${
                  isCurrent
                    ? 'bg-teal-600 ring-4 ring-teal-100 dark:ring-teal-950'
                    : isDone
                      ? 'bg-emerald-500'
                      : 'bg-gray-300 dark:bg-gray-700'
                }`}
              />
              <span
                className={`text-[12px] ${
                  isCurrent
                    ? 'font-bold text-teal-700 dark:text-teal-300'
                    : isDone
                      ? 'text-gray-700 dark:text-gray-200'
                      : 'text-gray-400'
                }`}
              >
                {t(`cal.lifecycle.${step.key}` as const)}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
        {t('cal.lifecycle.rescheduleNote')}
      </p>
    </div>
  )
}

// ── Appointment card (visual — click to manage) ─────────────────────────────────
function AppointmentCard({
  appt,
  onManage,
  compact = false,
}: {
  appt: AppointmentWithNames
  onManage: () => void
  compact?: boolean
}) {
  const { t } = useI18n()
  const urgent = isUrgent(appt)
  const source = sourceOf(appt)
  const border = urgent
    ? 'border-l-red-500'
    : source === 'ai'
      ? 'border-l-teal-500'
      : 'border-l-emerald-500'
  const bg = urgent ? 'bg-red-50/60 dark:bg-red-950/30' : 'bg-white dark:bg-gray-900'

  return (
    <button
      type="button"
      onClick={onManage}
      className={`w-full rounded-lg border border-gray-200 border-l-4 ${border} ${bg} p-2.5 text-left shadow-sm transition hover:shadow dark:border-gray-800`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`font-semibold ${appt.status === 'cancelled' ? 'line-through' : ''}`}>
          {appt.patientName || t('cal.unknownPatient')}
        </span>
        <span className="shrink-0 font-mono text-[11.5px] tabular-nums text-gray-500">
          {timeOf(appt.startTime)}
          {!compact && `–${timeOf(appt.endTime)}`}
        </span>
      </div>
      {appt.serviceName && <p className="mt-0.5 text-[11.5px] text-gray-500">{appt.serviceName}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {urgent && <UrgentTag />}
        <SourceTag source={source} />
        <StatusBadge status={appt.status} />
        {appt.doctorName && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-teal-600 text-[9px] font-bold text-white">
              {initials(appt.doctorName)}
            </span>
            {appt.doctorName.replace(/^(dra?\.?)\s+/i, '')}
          </span>
        )}
      </div>
    </button>
  )
}

export default function CalendarPage() {
  const { t, language } = useI18n()
  // Role gating: useAuthGuard redirects a role without the 'calendar' capability
  // to /inbox (the codebase's permission-denied convention), so this page only
  // ever renders for authorized roles (secretary / doctor / admin).
  const { ready } = useAuthGuard(rolesWith('calendar'))
  // Screen 6 — the clinic comes from the shared active-clinic context (header switcher).
  const { clinicId } = useActiveClinic()
  const [date, setDate] = useState(todayISO())
  const [doctorId, setDoctorId] = useState('') // '' = all doctors
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [booking, setBooking] = useState(false)
  const [prefill, setPrefill] = useState<{ doctorId?: string; start?: string }>({})
  const [manageId, setManageId] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // A clinic switch invalidates the previously-picked doctor — fall back to all.
  useEffect(() => {
    setDoctorId('')
  }, [clinicId])

  // Auto-dismiss the success banner.
  useEffect(() => {
    if (!success) return
    const id = setTimeout(() => setSuccess(null), 6000)
    return () => clearTimeout(id)
  }, [success])

  const clinicQuery = useQuery({
    queryKey: ['clinic-current', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: Clinic }>('/clinics/current'),
  })
  const timezone = clinicQuery.data?.clinic.timezone ?? ''

  const doctorsQuery = useQuery({
    queryKey: ['doctors', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ doctors: Doctor[] }>(`/clinics/${clinicId}/doctors`),
  })
  const doctors = useMemo(
    () => (doctorsQuery.data?.doctors ?? []).filter((d) => d.isActive),
    [doctorsQuery.data],
  )

  const from = `${date}T00:00:00`
  const to = `${addDays(date, 1)}T00:00:00`
  const apptQuery = useQuery({
    queryKey: ['appointments', clinicId, date, doctorId],
    enabled: Boolean(clinicId),
    queryFn: () => {
      const q = new URLSearchParams({ from, to })
      if (doctorId) q.set('doctorId', doctorId)
      return api.get<{ appointments: AppointmentWithNames[] }>(
        `/clinics/${clinicId}/appointments?${q}`,
      )
    },
  })
  const appointments = apptQuery.data?.appointments ?? []

  const selectedDoctor = doctorId ? doctors.find((d) => d.id === doctorId) : undefined
  const manageAppt = manageId ? appointments.find((a) => a.id === manageId) : undefined

  // A single doctor is required for the grid (per-doctor lanes); all-doctors → list.
  const effectiveView: 'grid' | 'list' = doctorId ? view : 'list'

  const ranges = useMemo(
    () => (selectedDoctor ? rangesForDate(normalizeAvailability(selectedDoctor.availableDays), date) : []),
    [selectedDoctor, date],
  )

  const openBooking = (opts?: { doctorId?: string; start?: string }) => {
    setPrefill(opts ?? {})
    setBooking(true)
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="clinic-surface relative flex h-full flex-col overflow-hidden">
      {/* Title + controls */}
      <div className="shrink-0 border-b border-gray-200 bg-white/90 px-4 py-3 shadow-sm dark:border-gray-800 dark:bg-gray-900/80">
        <div className="clinic-page-header">
          <div>
            <p className="clinic-eyebrow">{t('cal.crumb')}</p>
            <h1 className="clinic-title">{t('cal.title')}</h1>
            <p className="clinic-subtitle">
              Coordinate AI-booked appointments, secretary edits, provider availability, and day-of exceptions in one schedule view.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openBooking(doctorId ? { doctorId } : undefined)}
            disabled={!clinicId || doctors.length === 0}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            + {t('cal.newBooking')}
          </button>
        </div>

        {/* Controls row: day-nav · view toggle · doctor filter */}
        <div className="clinic-toolbar mt-3">
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[auto_minmax(11rem,auto)_auto_auto_auto] sm:items-center">
            <button
              type="button"
              onClick={() => setDate((d) => addDays(d, -1))}
              aria-label={t('cal.prev')}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              ‹
            </button>
            <div className="rounded-md bg-gray-50 px-3 py-2 leading-tight dark:bg-gray-800">
              <span className="text-sm font-semibold capitalize">{formatDay(date, language)}</span>
              <span className="block text-[10.5px] text-gray-400">
                {isToday(date) ? `${t('cal.today')} · ` : ''}
                {timezone ? `${timezone} · ` : ''}
                {t('cal.clinicLocal')}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDate((d) => addDays(d, 1))}
              aria-label={t('cal.next')}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setDate(todayISO())}
              className="rounded-md px-3 py-2 text-xs font-medium text-teal-600 hover:bg-teal-50 dark:hover:bg-teal-950"
            >
              {t('cal.today')}
            </button>
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"
              aria-label={t('cal.crumb')}
            />
          </div>

          {/* View toggle — disabled (forced to list) when no single doctor is picked */}
          <div className="hidden overflow-hidden rounded-md border border-gray-300 sm:flex dark:border-gray-700">
            {(['grid', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                disabled={v === 'grid' && !doctorId}
                className={`px-3 py-1 text-xs ${
                  effectiveView === v
                    ? 'bg-teal-50 font-semibold text-teal-700 dark:bg-teal-950 dark:text-teal-300'
                    : 'text-gray-500 hover:bg-gray-50 disabled:opacity-40 dark:hover:bg-gray-800'
                }`}
              >
                {v === 'grid' ? t('cal.viewDay') : t('cal.viewList')}
              </button>
            ))}
          </div>

          <div className="flex w-full flex-col gap-1 sm:ml-auto sm:w-auto sm:flex-row sm:items-center sm:gap-2">
            <label htmlFor="doc" className="text-[11px] uppercase tracking-wide text-gray-400">
              {t('cal.doctor')}
            </label>
            <select
              id="doc"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
              disabled={!clinicId || doctors.length === 0}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 sm:w-auto"
            >
              <option value="">{t('cal.allDoctors')}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.specialty ? ` — ${d.specialty}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3">
          <TodayCommandCenter compact />
        </div>
      </div>

      {/* Success banner */}
      {success && (
        <div className="shrink-0 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          ✓ {t('cal.bookSuccess', { patient: success })}{' '}
          <span className="text-emerald-600 dark:text-emerald-400">{t('cal.bookSuccessHint')}</span>
        </div>
      )}

      {/* Body: grid/list + rail */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {!clinicId ? (
            <div className="clinic-empty-state text-sm">{t('cal.selectDoctor')}</div>
          ) : doctorsQuery.isLoading ? (
            <GridSkeleton label={t('cal.loading')} />
          ) : doctors.length === 0 ? (
            <EmptyState icon="👩‍⚕️" title={t('cal.noDoctors')} />
          ) : apptQuery.isLoading ? (
            <GridSkeleton label={t('cal.loading')} />
          ) : apptQuery.isError ? (
            <div className="clinic-empty-state border-red-200 bg-red-50 text-center dark:border-red-900 dark:bg-red-950">
              <div className="text-3xl">⚠️</div>
              <p className="mt-2 text-sm text-red-700 dark:text-red-300">{t('cal.error')}</p>
              <button
                type="button"
                onClick={() => apptQuery.refetch()}
                className="mt-3 rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
              >
                {t('common.retry')}
              </button>
            </div>
          ) : (
            <>
              {/* Per-doctor disconnected-calendar banner */}
              {selectedDoctor && !selectedDoctor.calendarConnected && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <span className="font-bold">⚠</span>
                  <div>
                    <p className="font-semibold">
                      {t('cal.disconnected')} — {selectedDoctor.name}
                    </p>
                    <p className="mt-0.5">{t('cal.disconnectedHint')}</p>
                  </div>
                </div>
              )}

              {/* Doctor strip */}
              {selectedDoctor && (
                <DoctorStrip doctor={selectedDoctor} ranges={ranges} />
              )}

              {effectiveView === 'grid' && selectedDoctor ? (
                ranges.length === 0 ? (
                  <EmptyState
                    icon="🌙"
                    title={t('cal.dayOff')}
                    hint={`${selectedDoctor.name}`}
                  />
                ) : (
                  <DayGrid
                    ranges={ranges}
                    appointments={appointments}
                    onManage={setManageId}
                    onBookSlot={(start) => openBooking({ doctorId, start })}
                  />
                )
              ) : appointments.length === 0 ? (
                <EmptyState
                  icon="🗓️"
                  title={doctorId ? t('cal.emptyDoctor') : t('cal.empty')}
                  action={
                    <button
                      type="button"
                      onClick={() => openBooking(doctorId ? { doctorId } : undefined)}
                      className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
                    >
                      + {t('cal.newBooking')}
                    </button>
                  }
                />
              ) : (
                <DayList appointments={appointments} onManage={setManageId} />
              )}

              <Legend />
            </>
          )}
        </div>

        {/* Right rail (desktop, per-doctor) */}
        {clinicId && selectedDoctor && (
          <aside className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-gray-200 bg-white/85 p-4 lg:block dark:border-gray-800 dark:bg-gray-900/80">
            <FreeSlotsRail
              clinicId={clinicId}
              doctor={selectedDoctor}
              date={date}
              appointments={appointments}
              onBookSlot={(start) => openBooking({ doctorId, start })}
            />
            <ActivityFeed clinicId={clinicId} date={date} doctorId={doctorId} />
          </aside>
        )}
      </div>

      {/* Mobile FAB */}
      {clinicId && doctors.length > 0 && (
        <button
          type="button"
          onClick={() => openBooking(doctorId ? { doctorId } : undefined)}
          aria-label={t('cal.newBooking')}
          className="absolute bottom-5 right-5 flex h-12 w-12 items-center justify-center rounded-full bg-teal-600 text-2xl text-white shadow-lg hover:bg-teal-700 lg:hidden"
        >
          +
        </button>
      )}

      {/* Booking slide-over */}
      <SlideOver open={booking} onClose={() => setBooking(false)} title={t('cal.newBooking')}>
        <BookingPanel
          clinicId={clinicId}
          doctors={doctors}
          date={date}
          initialDoctorId={prefill.doctorId}
          initialStart={prefill.start}
          onClose={() => setBooking(false)}
          onSuccess={(patient) => {
            setBooking(false)
            setSuccess(patient)
          }}
        />
      </SlideOver>

      {/* Manage-appointment slide-over (lifecycle + reschedule + urgency) */}
      <SlideOver open={Boolean(manageAppt)} onClose={() => setManageId(null)} title={t('cal.manage')}>
        {manageAppt && (
          <ManagePanel clinicId={clinicId} appt={manageAppt} onClose={() => setManageId(null)} />
        )}
      </SlideOver>
    </div>
  )
}

// ── Doctor strip (name chip + working-hours summary) ────────────────────────────
function DoctorStrip({ doctor, ranges }: { doctor: Doctor; ranges: { start: string; end: string }[] }) {
  const { t } = useI18n()
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
      <span className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white py-0.5 pl-0.5 pr-3 dark:border-gray-700 dark:bg-gray-900">
        <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-teal-600 text-[10px] font-bold text-white">
          {initials(doctor.name)}
        </span>
        <span className="font-medium">{doctor.name}</span>
      </span>
      {ranges.length > 0 ? (
        <span className="text-gray-400">
          {t('cal.workingHours')}: <b className="text-gray-600 dark:text-gray-300">{formatRanges(ranges)}</b>
          {' · '}
          {t('cal.slotMinutes', { n: 30 })}
          {isSplitShift(ranges) ? ` · ${t('cal.splitShift')}` : ''}
        </span>
      ) : (
        <span className="text-gray-400">{t('cal.dayOff')}</span>
      )}
    </div>
  )
}

// ── Day grid (per-doctor hour lanes) ────────────────────────────────────────────
function DayGrid({
  ranges,
  appointments,
  onManage,
  onBookSlot,
}: {
  ranges: { start: string; end: string }[]
  appointments: AppointmentWithNames[]
  onManage: (id: string) => void
  onBookSlot: (start: string) => void
}) {
  const { t } = useI18n()
  const axis = useMemo(() => buildDayAxis(ranges, 30), [ranges])
  const axisStart = axis.length ? minOf(axis[0]!.time) : 0
  const axisEnd = axis.length ? minOf(axis.at(-1)!.time) + 30 : 0

  // Bucket each appointment into the 30-min row that contains its start.
  const byRow = useMemo(() => {
    const map = new Map<string, AppointmentWithNames[]>()
    const outside: AppointmentWithNames[] = []
    for (const a of appointments) {
      const m = minOf(timeOf(a.startTime))
      if (m < axisStart || m >= axisEnd) {
        outside.push(a)
        continue
      }
      const slotMin = axisStart + Math.floor((m - axisStart) / 30) * 30
      const key = `${String(Math.floor(slotMin / 60)).padStart(2, '0')}:${String(slotMin % 60).padStart(2, '0')}`
      const arr = map.get(key) ?? []
      arr.push(a)
      map.set(key, arr)
    }
    return { map, outside }
  }, [appointments, axisStart, axisEnd])

  return (
    <div className="clinic-card overflow-hidden">
      {axis.map((row) => {
        const appts = byRow.map.get(row.time) ?? []
        return (
          <div key={row.time} className="grid grid-cols-[56px_1fr]">
            <div className="border-t border-gray-100 px-2 py-1.5 text-right text-[11px] text-gray-400 dark:border-gray-800">
              {row.time}
            </div>
            <div
              className={`min-h-[56px] border-l border-t border-gray-100 p-1.5 dark:border-gray-800 ${
                row.kind === 'break'
                  ? 'bg-amber-50/40 dark:bg-amber-950/20'
                  : 'bg-white dark:bg-gray-900'
              }`}
            >
              {appts.length > 0 ? (
                <div className="space-y-1.5">
                  {appts.map((a) => (
                    <AppointmentCard key={a.id} appt={a} onManage={() => onManage(a.id)} />
                  ))}
                </div>
              ) : row.kind === 'break' ? (
                <span className="text-[10.5px] italic text-gray-400">{t('cal.break')}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onBookSlot(row.time)}
                  className="text-[10.5px] italic text-gray-300 hover:text-teal-500 dark:text-gray-600"
                >
                  {t('cal.free')}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {byRow.outside.length > 0 && (
        <div className="space-y-1.5 border-t border-gray-100 p-2 dark:border-gray-800">
          {byRow.outside.map((a) => (
            <AppointmentCard key={a.id} appt={a} onManage={() => onManage(a.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Day list (all-doctors / list view / mobile) ─────────────────────────────────
function DayList({
  appointments,
  onManage,
}: {
  appointments: AppointmentWithNames[]
  onManage: (id: string) => void
}) {
  return (
    <ul className="space-y-2">
      {appointments.map((a) => (
        <li key={a.id} className="flex items-stretch gap-2">
          <div className="w-12 shrink-0 pt-1 text-right font-mono text-[11px] tabular-nums text-gray-400">
            {timeOf(a.startTime)}
          </div>
          <div className="min-w-0 flex-1">
            <AppointmentCard appt={a} onManage={() => onManage(a.id)} />
          </div>
        </li>
      ))}
    </ul>
  )
}

// ── Legend ──────────────────────────────────────────────────────────────────────
function Legend() {
  const { t } = useI18n()
  const item = (color: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className={`h-3.5 w-3.5 rounded border-l-4 ${color}`} />
      {label}
    </span>
  )
  return (
    <div className="mt-4 flex flex-wrap gap-4 border-t border-gray-200 pt-3 text-[11.5px] text-gray-500 dark:border-gray-800">
      {item('border-l-teal-500', t('cal.legendAi'))}
      {item('border-l-emerald-500', t('cal.legendStaff'))}
      {item('border-l-red-500', t('cal.legendUrgent'))}
      <span className="text-gray-400">{t('cal.legendStatuses')}</span>
    </div>
  )
}

// ── Free-slots rail ─────────────────────────────────────────────────────────────
function FreeSlotsRail({
  clinicId,
  doctor,
  date,
  appointments,
  onBookSlot,
}: {
  clinicId: string
  doctor: Doctor
  date: string
  appointments: AppointmentWithNames[]
  onBookSlot: (start: string) => void
}) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['slots', clinicId, doctor.id, '', date],
    queryFn: () =>
      api.get<SlotsResponse>(
        `/clinics/${clinicId}/appointments/slots?${new URLSearchParams({ doctorId: doctor.id, date })}`,
      ),
  })

  const taken = useMemo(
    () =>
      appointments
        .filter((a) => a.status !== 'cancelled')
        .map((a) => timeOf(a.startTime)),
    [appointments],
  )

  return (
    <section className="mb-5">
      <h3 className="text-sm font-semibold">{t('cal.freeSlots')}</h3>
      <p className="mt-0.5 text-[11.5px] text-gray-400">{t('cal.freeSlotsHint')}</p>
      <div className="clinic-card mt-3 p-3">
        <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
          🟢 {t('cal.availableToBook')}
        </p>
        {query.isLoading ? (
          <p className="text-xs text-gray-400">{t('cal.slotsLoading')}</p>
        ) : query.isError ? (
          <p className="text-xs text-red-600">{t('cal.error')}</p>
        ) : !query.data?.working ? (
          <p className="text-xs text-gray-400">{t('cal.dayOff')}</p>
        ) : query.data.slots.length === 0 && taken.length === 0 ? (
          <p className="text-xs text-gray-400">{t('cal.noSlots')}</p>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {query.data.slots.map((s) => (
              <button
                key={s.start}
                type="button"
                onClick={() => onBookSlot(s.start)}
                className="rounded-md border border-emerald-200 bg-emerald-50 py-1.5 text-center text-xs font-semibold tabular-nums text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
              >
                {s.start}
              </button>
            ))}
            {taken.map((tk, i) => (
              <span
                key={`${tk}-${i}`}
                className="rounded-md border border-gray-200 bg-gray-50 py-1.5 text-center text-xs font-medium tabular-nums text-gray-400 line-through dark:border-gray-800 dark:bg-gray-800"
              >
                {tk}
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

// ── AI booking activity feed ────────────────────────────────────────────────────
const FEED_DOT: Record<string, string> = {
  ai: 'bg-teal-500',
  staff: 'bg-emerald-500',
  cancelled: 'bg-gray-400',
  no_show: 'bg-red-500',
  rescheduled: 'bg-amber-500',
}

function feedLabel(ev: AppointmentEventFeedItem): { key: string; via: 'viaAi' | 'viaStaff'; dot: string } {
  if (ev.eventType === 'created') {
    return ev.aiSourced
      ? { key: 'cal.feed.bookedAi', via: 'viaAi', dot: FEED_DOT.ai! }
      : { key: 'cal.feed.bookedStaff', via: 'viaStaff', dot: FEED_DOT.staff! }
  }
  const dot = FEED_DOT[ev.eventType] ?? (ev.aiSourced ? FEED_DOT.ai! : FEED_DOT.staff!)
  return { key: `cal.feed.${ev.eventType}`, via: ev.aiSourced ? 'viaAi' : 'viaStaff', dot }
}

function ActivityFeed({ clinicId, date, doctorId }: { clinicId: string; date: string; doctorId: string }) {
  const { t } = useI18n()
  const from = `${date}T00:00:00`
  const to = `${addDays(date, 1)}T00:00:00`
  const query = useQuery({
    queryKey: ['appt-events', clinicId, date, doctorId],
    queryFn: () => {
      const q = new URLSearchParams({ from, to })
      if (doctorId) q.set('doctorId', doctorId)
      return api.get<{ events: AppointmentEventFeedItem[] }>(
        `/clinics/${clinicId}/appointments/events?${q}`,
      )
    },
  })
  const events = query.data?.events ?? []

  return (
    <section>
      <h3 className="text-sm font-semibold">{t('cal.activity')}</h3>
      <p className="mt-0.5 text-[11.5px] text-gray-400">{t('cal.activityHint')}</p>
      <div className="clinic-card mt-3 p-3">
        {query.isLoading ? (
          <p className="text-xs text-gray-400">{t('common.loading')}</p>
        ) : query.isError ? (
          <p className="text-xs text-red-600">{t('cal.activityError')}</p>
        ) : events.length === 0 ? (
          <p className="text-xs text-gray-400">{t('cal.activityEmpty')}</p>
        ) : (
          <div className="flex flex-col">
            {events.map((ev) => {
              const { key, via, dot } = feedLabel(ev)
              const patient = ev.patientName || t('cal.unknownPatient')
              return (
                <div
                  key={ev.id}
                  className="flex gap-2.5 border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-800"
                >
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot}`} />
                  <div className="text-xs text-gray-600 dark:text-gray-300">
                    <span className="font-medium text-gray-800 dark:text-gray-100">
                      {t(key as 'cal.feed.bookedAi', { patient })}
                    </span>{' '}
                    · {timeOf(ev.startTime)}
                    <div className="mt-0.5 text-[10.5px] text-gray-400">
                      {t(`cal.feed.${via}`)} · {timeOf(ev.createdAt)}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ── Shared bits: empty state, skeleton ──────────────────────────────────────────
function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: string
  title: string
  hint?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-200 bg-white px-6 py-12 text-center dark:border-gray-800 dark:bg-gray-900">
      <div className="text-3xl">{icon}</div>
      <h4 className="text-sm font-semibold">{title}</h4>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
      {action}
    </div>
  )
}

function GridSkeleton({ label }: { label: string }) {
  return (
    <div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800"
            style={{ width: `${100 - i * 6}%` }}
          />
        ))}
      </div>
      <p className="mt-3 text-center text-xs text-gray-400">{label}</p>
    </div>
  )
}

// ── Shared free-slot picker (booking + reschedule) ──────────────────────────────
function SlotPicker({
  clinicId,
  doctorId,
  serviceId,
  date,
  value,
  onPick,
}: {
  clinicId: string
  doctorId: string
  serviceId: string
  date: string
  value: string
  onPick: (start: string) => void
}) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['slots', clinicId, doctorId, serviceId, date],
    enabled: Boolean(clinicId && doctorId && date),
    queryFn: () => {
      const q = new URLSearchParams({ doctorId, date })
      if (serviceId) q.set('serviceId', serviceId)
      return api.get<SlotsResponse>(`/clinics/${clinicId}/appointments/slots?${q}`)
    },
  })

  if (!doctorId) return <p className="text-xs text-gray-400">{t('cal.selectDoctor')}</p>
  if (query.isLoading) return <p className="text-xs text-gray-400">{t('cal.slotsLoading')}</p>
  if (query.isError) return <p className="text-xs text-red-600">{t('cal.error')}</p>

  const data = query.data
  if (!data) return null
  if (!data.working) return <p className="text-xs text-gray-400">{t('cal.dayOff')}</p>
  if (data.slots.length === 0) return <p className="text-xs text-gray-400">{t('cal.noSlots')}</p>

  return (
    <div className="space-y-2">
      {!data.calendarConnected && (
        <p className="text-xs text-amber-700 dark:text-amber-400">⚠ {t('cal.disconnectedDoctor')}</p>
      )}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
        {data.slots.map((s) => (
          <button
            key={s.start}
            type="button"
            onClick={() => onPick(s.start)}
            className={`rounded-md border px-2 py-1.5 text-sm ${
              value === s.start
                ? 'border-teal-600 bg-teal-600 font-semibold text-white'
                : 'border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800'
            }`}
          >
            {s.start}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Booking form ────────────────────────────────────────────────────────────────
function BookingPanel({
  clinicId,
  doctors,
  date: initialDate,
  initialDoctorId,
  initialStart,
  onClose,
  onSuccess,
}: {
  clinicId: string
  doctors: Doctor[]
  date: string
  initialDoctorId?: string
  initialStart?: string
  onClose: () => void
  onSuccess: (patientName: string) => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [doctorId, setDoctorId] = useState(initialDoctorId ?? doctors[0]?.id ?? '')
  const [serviceId, setServiceId] = useState('')
  const [patientId, setPatientId] = useState('')
  const [date, setDate] = useState(initialDate)
  const [start, setStart] = useState(initialStart ?? '')
  const [notes, setNotes] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [errorKey, setErrorKey] = useState<'cal.bookError' | 'cal.slotTaken' | null>(null)

  const servicesQuery = useQuery({
    queryKey: ['services', clinicId],
    queryFn: () => api.get<{ services: Service[] }>(`/clinics/${clinicId}/services`),
  })
  const patientsQuery = useQuery({
    queryKey: ['booking-patients', clinicId],
    queryFn: () =>
      api.get<{ patients: BookingPatient[] }>(`/clinics/${clinicId}/appointments/patients`),
  })
  const services = servicesQuery.data?.services ?? []
  const patients = patientsQuery.data?.patients ?? []
  const patientName = patients.find((p) => p.id === patientId)?.fullName || t('cal.unknownPatient')

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/clinics/${clinicId}/appointments`, {
        patientId,
        doctorId,
        serviceId: serviceId || undefined,
        date,
        start,
        notes: notes || undefined,
        urgent: urgent || undefined,
      }),
    onMutate: () => setErrorKey(null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['appointments', clinicId] })
      qc.invalidateQueries({ queryKey: ['appt-events', clinicId] })
      qc.invalidateQueries({ queryKey: ['slots', clinicId] })
      onSuccess(patientName)
    },
    onError: (e) =>
      setErrorKey(e instanceof ApiError && e.status === 409 ? 'cal.slotTaken' : 'cal.bookError'),
  })

  const canSubmit = Boolean(doctorId && patientId && date && start) && !mutation.isPending

  return (
    <div className="space-y-3">
      <label className="block text-sm">
        <span className="text-gray-500">{t('cal.patient')}</span>
        <select
          value={patientId}
          onChange={(e) => setPatientId(e.target.value)}
          className={`${field} mt-1`}
        >
          <option value="">{t('cal.selectPatient')}</option>
          {patients.map((p) => (
            <option key={p.id} value={p.id}>
              {p.fullName || t('cal.unknownPatient')}
            </option>
          ))}
        </select>
        {patients.length === 0 && !patientsQuery.isLoading && (
          <span className="mt-1 block text-xs text-gray-400">{t('cal.noPatients')}</span>
        )}
      </label>

      <label className="block text-sm">
        <span className="text-gray-500">{t('cal.doctor')}</span>
        <select
          value={doctorId}
          onChange={(e) => {
            setDoctorId(e.target.value)
            setStart('')
          }}
          className={`${field} mt-1`}
        >
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.specialty ? ` — ${d.specialty}` : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="text-gray-500">{t('cal.service')}</span>
        <select
          value={serviceId}
          onChange={(e) => {
            setServiceId(e.target.value)
            setStart('')
          }}
          className={`${field} mt-1`}
        >
          <option value="">{t('cal.noService')}</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {s.durationMinutes} min
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm">
        <span className="text-gray-500">{t('cal.book')}</span>
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) {
              setDate(e.target.value)
              setStart('')
            }
          }}
          className={`${field} mt-1`}
        />
      </label>

      <div className="text-sm">
        <span className="text-gray-500">{t('cal.pickSlot')}</span>
        <div className="mt-1">
          <SlotPicker
            clinicId={clinicId}
            doctorId={doctorId}
            serviceId={serviceId}
            date={date}
            value={start}
            onPick={setStart}
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={urgent}
          onChange={(e) => setUrgent(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
        />
        <span className="font-medium text-red-600">{t('cal.urgentField')}</span>
      </label>

      <label className="block text-sm">
        <span className="text-gray-500">{t('cal.notes')}</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('cal.notesPlaceholder')}
          rows={2}
          className={`${field} mt-1`}
        />
      </label>

      {errorKey && <p className="text-xs text-red-600">{t(errorKey)}</p>}

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!canSubmit}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {mutation.isPending ? t('cal.booking') : t('cal.confirm')}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
        >
          {t('cal.bookingClosed')}
        </button>
      </div>
    </div>
  )
}

// ── Manage panel (lifecycle + reschedule + urgency toggle) ──────────────────────
function ManagePanel({
  clinicId,
  appt,
  onClose,
}: {
  clinicId: string
  appt: AppointmentWithNames
  onClose: () => void
}) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const [date, setDate] = useState(appt.startTime.slice(0, 10))
  const [start, setStart] = useState('')
  const [errorKey, setErrorKey] = useState<'cal.bookError' | 'cal.slotTaken' | 'cal.actionError' | null>(
    null,
  )

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['appointments', clinicId] })
    qc.invalidateQueries({ queryKey: ['appt-events', clinicId] })
    qc.invalidateQueries({ queryKey: ['slots', clinicId] })
  }

  const statusMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/clinics/${clinicId}/appointments/${appt.id}`, body),
    onMutate: () => setErrorKey(null),
    onSuccess: () => {
      invalidate()
      onClose()
    },
    onError: () => setErrorKey('cal.actionError'),
  })

  const rescheduleMutation = useMutation({
    mutationFn: () => api.patch(`/clinics/${clinicId}/appointments/${appt.id}`, { date, start }),
    onMutate: () => setErrorKey(null),
    onSuccess: () => {
      invalidate()
      onClose()
    },
    onError: (e) =>
      setErrorKey(e instanceof ApiError && e.status === 409 ? 'cal.slotTaken' : 'cal.bookError'),
  })

  const terminal = TERMINAL_STATUSES.includes(appt.status)
  const urgent = isUrgent(appt)
  const busy = statusMutation.isPending || rescheduleMutation.isPending

  const actionBtn =
    'rounded-md border px-2.5 py-1.5 text-xs font-medium disabled:opacity-50'

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="clinic-card bg-gray-50 p-3 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{appt.patientName || t('cal.unknownPatient')}</p>
          <StatusBadge status={appt.status} />
        </div>
        <p className="mt-0.5 font-mono text-xs text-gray-500">
          {timeOf(appt.startTime)}–{timeOf(appt.endTime)}
        </p>
        <p className="text-xs text-gray-500">
          {appt.doctorName && t('cal.withDoctor', { doctor: appt.doctorName })}
          {appt.serviceName && ` · ${appt.serviceName}`}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {urgent && <UrgentTag />}
          <SourceTag source={sourceOf(appt)} />
        </div>
        {appt.notes && <p className="mt-2 text-xs text-gray-400">{appt.notes}</p>}
      </div>

      {/* Lifecycle actions */}
      <AppointmentLifecycleRail appt={appt} />

      {!terminal && (
        <div className="flex flex-wrap gap-2">
          {appt.status === 'pending' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => statusMutation.mutate({ status: 'confirmed' })}
              className={`${actionBtn} border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300`}
            >
              {t('cal.confirmAppt')}
            </button>
          )}
          {(appt.status === 'confirmed' || appt.status === 'pending') && (
            <button
              type="button"
              disabled={busy}
              onClick={() => statusMutation.mutate({ status: 'arrived' })}
              className={`${actionBtn} border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-900 dark:text-teal-300`}
            >
              {t('cal.markArrived')}
            </button>
          )}
          {appt.status === 'arrived' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => statusMutation.mutate({ status: 'in_progress' })}
              className={`${actionBtn} border-teal-300 text-teal-700 hover:bg-teal-50 dark:border-teal-900 dark:text-teal-300`}
            >
              {t('cal.markInProgress')}
            </button>
          )}
          {(appt.status === 'in_progress' ||
            appt.status === 'arrived' ||
            appt.status === 'confirmed') && (
            <button
              type="button"
              disabled={busy}
              onClick={() => statusMutation.mutate({ status: 'completed' })}
              className={`${actionBtn} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300`}
            >
              {t('cal.markCompleted')}
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => statusMutation.mutate({ status: 'no_show' })}
            className={`${actionBtn} border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300`}
          >
            {t('cal.markNoShow')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => statusMutation.mutate({ urgent: !urgent })}
            className={`${actionBtn} border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950`}
          >
            {urgent ? t('cal.unmarkUrgent') : t('cal.markUrgent')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (confirm(t('cal.cancelConfirm'))) statusMutation.mutate({ status: 'cancelled' })
            }}
            className={`${actionBtn} border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950`}
          >
            {t('cal.cancel')}
          </button>
        </div>
      )}

      {/* Reschedule */}
      {!terminal && (
        <div className="space-y-2 border-t border-gray-200 pt-3 dark:border-gray-800">
          <p className="text-sm font-semibold">{t('cal.reschedule')}</p>
          <label className="block text-sm">
            <span className="text-gray-500">{t('cal.book')}</span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                if (e.target.value) {
                  setDate(e.target.value)
                  setStart('')
                }
              }}
              className={`${field} mt-1`}
            />
          </label>
          <SlotPicker
            clinicId={clinicId}
            doctorId={appt.doctorId ?? ''}
            serviceId={appt.serviceId ?? ''}
            date={date}
            value={start}
            onPick={setStart}
          />
          <button
            type="button"
            onClick={() => rescheduleMutation.mutate()}
            disabled={!start || busy}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {rescheduleMutation.isPending ? t('cal.rescheduling') : t('cal.reschedule')}
          </button>
        </div>
      )}

      {errorKey && <p className="text-xs text-red-600">{t(errorKey)}</p>}

      <button
        type="button"
        onClick={onClose}
        className="w-full rounded-md border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
      >
        {t('cal.bookingClosed')}
      </button>
    </div>
  )
}
