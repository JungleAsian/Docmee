'use client'

// Inbox redesign (#2) — a compact appointment-booking calendar embedded in the
// right context rail so a secretary can view a doctor's free slots and book one
// for the current patient without leaving the conversation. Deliberately mirrors
// the full Calendar page's flow (pick a doctor → pick a date → pick a free slot →
// confirm) against the same API: GET /clinics/:id/appointments/slots and
// POST /clinics/:id/appointments. Booking always targets the conversation's own
// patient (no patient picker needed here).
import { forwardRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { useActiveClinic } from '../hooks/useActiveClinic'
import type { Conversation, Doctor, SlotsResponse } from '../types'

// Local YYYY-MM-DD for the date input's default (today), in the operator's tz.
function todayLocal(): string {
  const d = new Date()
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 10)
}

export const AppointmentBookingCard = forwardRef<
  HTMLElement,
  { conversationId: string; expanded: boolean; onToggle: () => void }
>(function AppointmentBookingCard({ conversationId, expanded, onToggle }, ref) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const { clinicId } = useActiveClinic()
  const [doctorId, setDoctorId] = useState('')
  const [date, setDate] = useState(todayLocal())
  const [slot, setSlot] = useState('')
  const [errorKey, setErrorKey] = useState<string | null>(null)
  const [booked, setBooked] = useState(false)

  const conversationQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<{ conversation: Conversation }>(`/conversations/${conversationId}`),
  })
  const patientId = conversationQuery.data?.conversation?.patientId ?? null

  const doctorsQuery = useQuery({
    queryKey: ['doctors', clinicId],
    enabled: Boolean(clinicId) && expanded,
    queryFn: () => api.get<{ doctors: Doctor[] }>(`/clinics/${clinicId}/doctors`),
  })
  const doctors = (doctorsQuery.data?.doctors ?? []).filter((d) => d.isActive)

  const slotsQuery = useQuery({
    queryKey: ['slots', clinicId, doctorId, date],
    enabled: Boolean(clinicId && doctorId && date) && expanded,
    queryFn: () =>
      api.get<SlotsResponse>(
        `/clinics/${clinicId}/appointments/slots?${new URLSearchParams({ doctorId, date })}`,
      ),
  })
  const slotsData = slotsQuery.data

  const bookMutation = useMutation({
    mutationFn: () =>
      api.post(`/clinics/${clinicId}/appointments`, { patientId, doctorId, date, start: slot }),
    onMutate: () => {
      setErrorKey(null)
      setBooked(false)
    },
    onSuccess: () => {
      setBooked(true)
      setSlot('')
      qc.invalidateQueries({ queryKey: ['patient-appointments', patientId] })
      qc.invalidateQueries({ queryKey: ['appointments', clinicId] })
      qc.invalidateQueries({ queryKey: ['slots', clinicId, doctorId, date] })
    },
    onError: (e) =>
      setErrorKey(e instanceof ApiError && e.status === 409 ? 'cal.slotTaken' : 'cal.bookError'),
  })

  return (
    <section
      ref={ref}
      className="rounded-[var(--crm-border-radius-md)] border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] shadow-[var(--crm-shadow-sm)]"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--crm-text-muted)]">
          📅 {t('cal.title')}
        </span>
        <span aria-hidden className="text-[var(--crm-text-muted)]">
          {expanded ? '▾' : '▸'}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[var(--crm-border-color)] px-4 py-3">
          {/* Doctor — chosen first, before any schedule is shown. */}
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[var(--crm-text-muted)]">
              {t('cal.doctor')}
            </span>
            <select
              value={doctorId}
              onChange={(e) => {
                setDoctorId(e.target.value)
                setSlot('')
                setBooked(false)
              }}
              className="w-full rounded-lg border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] px-2 py-1.5 text-xs outline-none focus:border-[var(--crm-primary-color)]"
            >
              <option value="">{t('cal.selectDoctor')}</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.specialty ? ` · ${d.specialty}` : ''}
                </option>
              ))}
            </select>
            {doctorsQuery.isSuccess && doctors.length === 0 && (
              <p className="mt-1 text-[11px] text-[var(--crm-text-muted)]">{t('cal.noDoctors')}</p>
            )}
          </label>

          {/* Date */}
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-[var(--crm-text-muted)]">
              {t('cal.today')}
            </span>
            <input
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value)
                setSlot('')
                setBooked(false)
              }}
              className="w-full rounded-lg border border-[var(--crm-border-color)] bg-[var(--crm-input-bg)] px-2 py-1.5 text-xs outline-none focus:border-[var(--crm-primary-color)]"
            />
          </label>

          {/* Slots — only after a doctor is chosen. */}
          {doctorId && (
            <div>
              {!slotsData?.calendarConnected && slotsData && (
                <p className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-[11px] text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  ⚠ {t('cal.disconnected')}
                </p>
              )}
              {slotsQuery.isLoading ? (
                <p className="text-[11px] text-[var(--crm-text-muted)]">{t('cal.slotsLoading')}</p>
              ) : slotsData && !slotsData.working ? (
                <p className="text-[11px] text-[var(--crm-text-muted)]">{t('cal.dayOff')}</p>
              ) : slotsData && slotsData.slots.length === 0 ? (
                <p className="text-[11px] text-[var(--crm-text-muted)]">{t('cal.noSlots')}</p>
              ) : slotsData ? (
                <>
                  <p className="mb-1.5 text-[11px] font-semibold text-[var(--crm-text-muted)]">
                    {t('cal.pickSlot')}
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {slotsData.slots.map((s) => (
                      <button
                        key={s.start}
                        type="button"
                        onClick={() => {
                          setSlot(s.start)
                          setBooked(false)
                        }}
                        className={`rounded-md border px-1 py-1 text-xs font-semibold transition ${
                          slot === s.start
                            ? 'border-[var(--crm-primary-color)] bg-[var(--crm-primary-color)] text-white'
                            : 'border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] text-[var(--crm-text-main)] hover:bg-[var(--crm-hover-bg)]'
                        }`}
                      >
                        {s.start}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {errorKey && (
            <p className="text-[11px] font-medium text-red-600 dark:text-red-400">⚠ {t(errorKey)}</p>
          )}
          {booked && (
            <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              ✓ {t('cal.booked')}
            </p>
          )}

          <button
            type="button"
            onClick={() => bookMutation.mutate()}
            disabled={!patientId || !doctorId || !slot || bookMutation.isPending}
            className="w-full rounded-lg bg-[var(--crm-primary-color)] px-3 py-2 text-xs font-bold text-white hover:bg-[var(--crm-primary-hover)] disabled:opacity-60"
          >
            {bookMutation.isPending ? t('cal.booking') : t('cal.confirm')}
          </button>
        </div>
      )}
    </section>
  )
})
