'use client'

// Inbox redesign — the always-visible Patient Information card at the top of the
// right context rail. Unlike the old collapsible PatientCard, the essentials a
// secretary needs on every thread stay on screen: who the patient is (name +
// WhatsApp number), whether they are new or returning, their last and next
// appointment, and one-tap access to the full history.
// Reuses the ['conversation', id], ['patient', id] and
// ['patient-appointments', id] queries (TanStack dedupes them) so it adds no
// fetch beyond what the thread already loads.
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { avatarColor, avatarLabel, formatDateTime } from '../format'
import type { Appointment, Channel, Conversation, Patient, PatientStatus } from '../types'

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
}

// Req 16 — 'returning' is the reassuring positive case (teal, starred); 'new' is a
// neutral first-contact note; 'archived' is muted.
const STATUS_BADGE: Record<PatientStatus, { className: string; glyph: string }> = {
  new: { className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300', glyph: '✦' },
  returning: { className: 'bg-[var(--crm-hover-bg)] text-[var(--crm-primary-color)]', glyph: '★' },
  archived: { className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', glyph: '◦' },
}

export function PatientInfoCard({
  conversationId,
  showNextAppointment = true,
  showAppointmentDateTime = true,
  showPatientHistory = true,
  showChatStatus = true,
}: {
  conversationId: string
  showNextAppointment?: boolean
  showAppointmentDateTime?: boolean
  showPatientHistory?: boolean
  showChatStatus?: boolean
}) {
  const { t, language } = useI18n()

  const conversationQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<{ conversation: Conversation }>(`/conversations/${conversationId}`),
  })
  const conversation = conversationQuery.data?.conversation
  const patientId = conversation?.patientId ?? null

  const patientQuery = useQuery({
    queryKey: ['patient', patientId],
    enabled: Boolean(patientId),
    queryFn: () => api.get<{ patient: Patient }>(`/patients/${patientId}`),
  })
  const patient = patientQuery.data?.patient
  const appointmentsQuery = useQuery({
    queryKey: ['patient-appointments', patientId],
    enabled: Boolean(patientId),
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/patients/${patientId}/appointments`),
  })

  const handle = conversation?.channelContactHandle ?? '…'
  const displayName = patient?.fullName ?? conversation?.patientName ?? handle
  const badge = patient ? STATUS_BADGE[patient.status] : null
  const channel = conversation?.channel

  // Next = soonest upcoming non-cancelled appointment; last = most recent past one.
  // (listByPatient returns newest-first, so `find(past)` is already the latest.)
  const appointments = appointmentsQuery.data?.appointments ?? []
  const now = new Date().toISOString()
  const next = appointments
    .filter((a) => a.startTime >= now && a.status !== 'cancelled')
    .sort((a, b) => a.startTime.localeCompare(b.startTime))[0]
  const last = appointments.find((a) => a.startTime < now)

  return (
    <section className="rounded-[var(--crm-border-radius-md)] border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] p-3 shadow-[var(--crm-shadow-sm)]">
      {/* Identity */}
      <div className="flex items-center gap-2.5">
        <span
          className="crm-conv-avatar !h-9 !w-9 !text-sm"
          style={{ background: avatarColor(conversationId) }}
        >
          {avatarLabel(handle)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-extrabold text-[var(--crm-text-main)]">{displayName}</p>
          <p className="truncate text-[10px] text-[var(--crm-text-muted)]">
            {channel === 'whatsapp' || !channel ? handle : `${CHANNEL_LABEL[channel]} · ${handle}`}
          </p>
        </div>
      </div>

      {/* New / returning */}
      {showChatStatus && badge && (
        <span
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}
        >
          {badge.glyph} {t(`patient.status.${patient!.status}` as const)}
        </span>
      )}

      {/* Last / next appointment. Date/time visibility is clinic-controlled. */}
      {showAppointmentDateTime && <dl className="mt-2 space-y-1 text-[10px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="font-medium text-[var(--crm-text-muted)]">{t('view.appt.last')}</dt>
          <dd className="min-w-0 truncate text-right text-[var(--crm-text-main)]">
            {last ? formatDateTime(last.startTime, language) : t('view.appt.none')}
          </dd>
        </div>
        {showNextAppointment && <div className="flex items-center justify-between gap-2">
          <dt className="font-medium text-[var(--crm-text-muted)]">{t('view.appt.next')}</dt>
          <dd className="min-w-0 truncate text-right text-[var(--crm-text-main)]">
            {next ? formatDateTime(next.startTime, language) : t('view.appt.none')}
          </dd>
        </div>}
      </dl>}

      {/* Actions */}
      {patientId && showPatientHistory && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={`/inbox/${conversationId}/patient`}
            className="inline-flex items-center gap-1 rounded-lg border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] hover:text-[var(--crm-primary-color)]"
          >
            {t('patient.title')} →
          </Link>
        </div>
      )}
    </section>
  )
}
