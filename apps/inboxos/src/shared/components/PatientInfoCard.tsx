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
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { avatarColor, avatarLabel, formatDateTime } from '../format'
import { InteractionModeToggle } from './InteractionModeToggle'
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

function HideDetailsIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  )
}

export function PatientInfoCard({
  conversationId,
  onHideDetails,
  showNextAppointment = true,
  showAppointmentDateTime = true,
  showPatientHistory = true,
  showChatStatus = true,
}: {
  conversationId: string
  onHideDetails?: () => void
  showNextAppointment?: boolean
  showAppointmentDateTime?: boolean
  showPatientHistory?: boolean
  showChatStatus?: boolean
}) {
  const { t, language } = useI18n()
  const [phoneVisible, setPhoneVisible] = useState(false)

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
  const personalConversation = patient?.automationMode === 'human_only'
  const patientMetadata = patient?.metadata && typeof patient.metadata === 'object' ? patient.metadata : undefined
  const appointmentsQuery = useQuery({
    queryKey: ['patient-appointments', patientId],
    enabled: Boolean(patientId),
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/patients/${patientId}/appointments`),
  })

  const handle = conversation?.channelContactHandle ?? '…'
  const displayName = patient?.fullName ?? conversation?.patientName ?? 'Patient'
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
          <div className="flex min-w-0 items-center gap-1.5">
            <p className="truncate text-xs font-extrabold text-[var(--crm-text-main)]">{displayName}</p>
            {personalConversation && (
              <span className="shrink-0 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                Personal
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-[var(--crm-text-muted)]">
            <span className="truncate">
              {phoneVisible
                ? channel === 'whatsapp' || !channel ? handle : `${CHANNEL_LABEL[channel]} · ${handle}`
                : 'Number hidden'}
            </span>
            <button
              type="button"
              onClick={() => setPhoneVisible((v) => !v)}
              className="shrink-0 rounded-full border border-[var(--crm-border-color)] px-1.5 py-0.5 text-[9px] font-bold hover:bg-[var(--crm-hover-bg)] hover:text-[var(--crm-primary-color)]"
            >
              {phoneVisible ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        {onHideDetails && (
          <button
            type="button"
            onClick={onHideDetails}
            title="Hide patient details"
            aria-label="Hide patient details"
            className="shrink-0 rounded p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-500 dark:hover:bg-gray-800"
          >
            <HideDetailsIcon />
          </button>
        )}
      </div>

      {/* New / returning */}
      {showChatStatus && badge && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${badge.className}`}
          >
            {badge.glyph} {t(`patient.status.${patient!.status}` as const)}
          </span>
          {personalConversation && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
              Personal Conversation
            </span>
          )}
        </div>
      )}

      {patientId && (
        <div className="crm-patient-status-controls mt-3 rounded-2xl border border-[var(--crm-border-color)] bg-[var(--crm-soft-bg)] p-2">
          <InteractionModeToggle patientId={patientId} metadata={patientMetadata} />
        </div>
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
          <Link prefetch={false}
            href={`/inbox/${conversationId}/patient`}
            className="inline-flex w-full items-center justify-center gap-1 rounded-xl border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] px-3 py-2 text-[11px] font-bold text-[var(--crm-text-muted)] hover:bg-[var(--crm-hover-bg)] hover:text-[var(--crm-primary-color)]"
          >
            {t('patient.title')} →
          </Link>
        </div>
      )}
    </section>
  )
}
