'use client'

// Screen 3 — Patient profile & history (Gap #26 / Req 10, 16). Reached from the
// conversation header. A two-column operational view: the left column carries the
// profile (with the returning/new/archived status signal + opted-out danger
// highlight), the bot-captured intake and the appointment + past-conversation
// timeline; the right column carries the summary, tags (worker safety flags surface
// in amber/red), private internal notes and the conversation status (bot vs human
// mode, assignment, urgency). Closed conversations are READ-ONLY here — this view
// never reopens them (Decision 4); reopening only ever happens from the live thread.
import { use, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/shared/api/client'
import { useI18n } from '@/shared/hooks/useI18n'
import { useTeam } from '@/shared/hooks/useTeam'
import { useOnline } from '@/shared/hooks/useOnline'
import { avatarColor, avatarLabel, formatDateTime, relativeTime } from '@/shared/format'
import { TAG_TYPES, tagColor, tagLabel } from '@/shared/tagTypes'
import { assessSafety } from '@/shared/safety'
import { conversationMode } from '@/shared/conversationMode'
import {
  lastInteractionAt,
  nextLiveAppointment,
  pastConversations,
  splitAppointments,
} from '@/shared/patientHistory'
import type {
  Appointment,
  AppointmentStatus,
  Conversation,
  Message,
  Note,
  Patient,
  PatientStatus,
  Tag,
} from '@/shared/types'

const APPT_BADGE: Record<AppointmentStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  confirmed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  arrived: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  in_progress: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  cancelled: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  completed: 'bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  no_show: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

// The timeline rail dot colour per appointment status — upcoming reads in brand
// blue, completed/past in slate, cancelled/no-show in rose.
function dotClass(a: Appointment, isPast: boolean): string {
  if (a.status === 'cancelled' || a.status === 'no_show') return 'border-rose-500'
  return isPast ? 'border-gray-400 dark:border-gray-500' : 'border-sky-600'
}

// Req 16 (returning-patient signal): emerald 'Returning' is the reassuring positive
// case (a known patient with prior history), indigo 'New' a first contact, gray
// 'Archived' an inactive record. Each carries a localized tooltip hint.
const PATIENT_STATUS_BADGE: Record<PatientStatus, string> = {
  new: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/40 dark:text-teal-300 dark:border-teal-800',
  returning:
    'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-800',
  archived:
    'bg-gray-100 text-gray-500 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700',
}
const PATIENT_STATUS_DOT: Record<PatientStatus, string> = {
  new: 'bg-teal-600',
  returning: 'bg-emerald-600',
  archived: 'bg-gray-400',
}

// Channel display names are brand proper nouns — not localized.
const CHANNEL_LABEL: Record<Conversation['channel'], string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
}

export default function PatientHistoryPage({
  params,
}: {
  params: Promise<{ conversationId: string }>
}) {
  const { conversationId } = use(params)
  const { t, language } = useI18n()
  const team = useTeam()
  const online = useOnline()

  const conversationQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<{ conversation: Conversation }>(`/conversations/${conversationId}`),
    retry: false,
  })
  const patientId = conversationQuery.data?.conversation.patientId ?? null

  const patientQuery = useQuery({
    queryKey: ['patient', patientId],
    enabled: Boolean(patientId),
    queryFn: () => api.get<{ patient: Patient }>(`/patients/${patientId}`),
    retry: false,
  })
  const appointmentsQuery = useQuery({
    queryKey: ['patient-appointments', patientId],
    enabled: Boolean(patientId),
    queryFn: () => api.get<{ appointments: Appointment[] }>(`/patients/${patientId}/appointments`),
  })
  const conversationsQuery = useQuery({
    queryKey: ['patient-conversations', patientId],
    enabled: Boolean(patientId),
    queryFn: () =>
      api.get<{ conversations: Conversation[] }>(`/patients/${patientId}/conversations`),
  })
  const tagsQuery = useQuery({
    queryKey: ['patient-tags', patientId],
    enabled: Boolean(patientId),
    queryFn: () => api.get<{ tags: Tag[] }>(`/patients/${patientId}/tags`),
  })
  const notesQuery = useQuery({
    queryKey: ['patient-notes', patientId],
    enabled: Boolean(patientId),
    queryFn: () => api.get<{ notes: Note[] }>(`/patients/${patientId}/notes`),
  })

  const conversation = conversationQuery.data?.conversation
  const patient = patientQuery.data?.patient
  const appointments = appointmentsQuery.data?.appointments ?? []
  const conversations = conversationsQuery.data?.conversations ?? []
  const tags = tagsQuery.data?.tags ?? []
  const notes = notesQuery.data?.notes ?? []

  const now = new Date().toISOString()
  const { upcoming, past } = splitAppointments(appointments, now)
  const history = pastConversations(conversations, conversationId)
  const nextAppointment = nextLiveAppointment(upcoming)
  const lastInteraction = lastInteractionAt(conversations)

  // The most recent closed thread is shown read-only; fetch its messages on demand.
  const readonlyConversationId = history[0]?.id ?? null
  const readonlyMessagesQuery = useQuery({
    queryKey: ['patient-readonly-messages', readonlyConversationId],
    enabled: Boolean(readonlyConversationId),
    queryFn: () =>
      api.get<{ messages: Message[] }>(`/conversations/${readonlyConversationId}/messages`),
  })

  // 403 on the conversation/patient fetch = this operator can't reach this clinic's
  // record (cross-tenant). Surface a dedicated permission-denied state.
  const denied =
    (conversationQuery.error instanceof ApiError && conversationQuery.error.status === 403) ||
    (patientQuery.error instanceof ApiError && patientQuery.error.status === 403)
  const erroredOut =
    !denied &&
    (conversationQuery.isError ||
      (Boolean(patientId) && patientQuery.isError && !(patientQuery.error instanceof ApiError && patientQuery.error.status === 404)))

  const backHref = `/inbox?c=${conversationId}`

  return (
    <div className="clinic-page clinic-page-md space-y-6">
      {/* Context strip / breadcrumb */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
        <Link prefetch={false} href={backHref} className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:text-sky-800 dark:text-sky-400">
          ← {t('patient.backToConversation')}
        </Link>
        <span className="text-gray-300 dark:text-gray-600">·</span>
        <Link prefetch={false} href="/inbox" className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
          {t('nav.inbox')}
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="font-semibold text-gray-700 dark:text-gray-200">{t('patient.profile')}</span>
      </div>

      {/* Offline / disconnected banner — a required operational state. */}
      {!online && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <span aria-hidden>⚠</span> {t('patient.offline')}
        </div>
      )}

      {conversationQuery.isLoading ? (
        <LoadingState />
      ) : denied ? (
        <CenteredState icon="🔒" title={t('patient.denied')} desc={t('patient.deniedDesc')} />
      ) : erroredOut ? (
        <CenteredState
          icon="⚠"
          title={t('patient.error')}
          desc={t('patient.errorDesc')}
          action={
            <button
              type="button"
              onClick={() => {
                conversationQuery.refetch()
                patientQuery.refetch()
              }}
              className="rounded-md bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-800"
            >
              {t('patient.retry')}
            </button>
          }
        />
      ) : !patientId ? (
        <CenteredState icon="🗂️" title={t('patient.noPatientTitle')} desc={t('patient.noPatient')} />
      ) : patientQuery.isLoading ? (
        <LoadingState />
      ) : !patient ? (
        <CenteredState icon="🔍" title={t('patient.notFound')} desc={t('patient.notFoundDesc')} />
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,1fr)]">
          {/* ============ LEFT COLUMN ============ */}
          <div className="space-y-4">
            <ProfileSection patient={patient} conversation={conversation} />
            <IntakeSection patient={patient} />
            <TimelineSection
              appointments={appointments}
              upcoming={upcoming}
              past={past}
              language={language}
              readonlyConversation={history[0] ?? null}
              readonlyMessages={readonlyMessagesQuery.data?.messages ?? []}
              readonlyLoading={readonlyMessagesQuery.isLoading}
            />
          </div>

          {/* ============ RIGHT COLUMN ============ */}
          <div className="space-y-4">
            <SummarySection
              lastInteraction={lastInteraction}
              nextAppointment={nextAppointment}
              language={language}
            />
            <TagsSection tags={tags} language={language} loading={tagsQuery.isLoading} />
            <NotesSection
              conversationId={conversationId}
              patientId={patientId}
              notes={notes}
              loading={notesQuery.isLoading}
              team={team}
            />
            <ConversationStatusSection conversation={conversation} tags={tags} team={team} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Profile ────────────────────────────────────────────────────────────────────
function ProfileSection({
  patient,
  conversation,
}: {
  patient: Patient
  conversation: Conversation | undefined
}) {
  const { t, language } = useI18n()
  const meta = patient.metadata as {
    language?: unknown
    consent?: unknown
    consentAt?: unknown
    optedOut?: unknown
  }
  const lang = meta.language === 'en' ? 'English (en)' : 'Español (es)'
  const optedOut = meta.optedOut === true
  const consentGranted = meta.consent === true
  const consentAt = typeof meta.consentAt === 'string' ? meta.consentAt : null
  const handle = conversation?.channelContactHandle ?? '—'
  const channelLabel = conversation ? CHANNEL_LABEL[conversation.channel] : 'WhatsApp'

  return (
    <Section
      title={t('patient.profile')}
      icon="👤"
      action={
        <span
          title={t(`patient.status.${patient.status}.hint` as const)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${PATIENT_STATUS_BADGE[patient.status]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${PATIENT_STATUS_DOT[patient.status]}`} />
          {t(`patient.status.${patient.status}` as const)}
        </span>
      }
    >
      <div className="flex items-start gap-4">
        <div
          className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-lg font-bold text-white"
          style={{ background: avatarColor(conversation?.id ?? patient.id) }}
        >
          {avatarLabel(patient.fullName ?? handle)}
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-gray-900 dark:text-gray-50">
            {patient.fullName ?? t('patient.unnamed')}
          </h3>
          <p className="mt-0.5 text-sm text-gray-400">
            {channelLabel} ·{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {handle}
            </code>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        <Field label={t('patient.name')} value={patient.fullName ?? '—'} src={t('patient.src.bot')} srcIcon="🤖" />
        <Field label={t('patient.language')} value={lang} src={t('patient.src.detected')} srcIcon="🌐" />
        <Field
          label={t('patient.waId')}
          value={handle}
          mono
          src={t('patient.src.channel')}
          srcIcon="📲"
        />
        <Field
          label={t('patient.consent')}
          value={
            optedOut
              ? `✕ ${t('patient.consent.optedOut')}`
              : consentGranted
                ? `✓ ${t('patient.consent.granted')}`
                : t('patient.consent.unknown')
          }
          valueClass={optedOut ? 'text-rose-600 dark:text-rose-400' : consentGranted ? 'text-emerald-600 dark:text-emerald-400' : ''}
          src={
            optedOut
              ? t('patient.consent.stop')
              : consentAt
                ? t('patient.consent.confirmedOn', { date: formatDateTime(consentAt, language) })
                : t('patient.src.consentRecord')
          }
          srcIcon={optedOut ? '⛔' : '📝'}
          srcClass={optedOut ? 'text-rose-600 dark:text-rose-400' : ''}
        />
      </div>

      {/* Opted-out danger highlight (Req 19) — unmistakable so no one re-contacts. */}
      {optedOut && (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-3 dark:border-rose-900 dark:bg-rose-950/40">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-rose-200 bg-white text-base text-rose-600 dark:border-rose-900 dark:bg-rose-950">
            ⛔
          </span>
          <div>
            <p className="text-sm font-bold text-rose-700 dark:text-rose-300">{t('patient.optedOut.title')}</p>
            <p className="text-xs text-rose-800/80 dark:text-rose-400/80">{t('patient.optedOut.desc')}</p>
          </div>
        </div>
      )}
    </Section>
  )
}

// ── Intake (Req 10) ──────────────────────────────────────────────────────────────
interface PatientIntake {
  reason?: unknown
  preferredDate?: unknown
  preferredTime?: unknown
  doctorName?: unknown
  specialty?: unknown
  source?: unknown
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function IntakeSection({ patient }: { patient: Patient }) {
  const { t } = useI18n()
  const meta = patient.metadata as { intake?: PatientIntake; source?: unknown }
  const intake = meta.intake ?? {}

  const reason = asText(intake.reason)
  const date = asText(intake.preferredDate)
  const time = asText(intake.preferredTime)
  const preferred = [date, time].filter(Boolean).join(' · ') || null
  const doctor = asText(intake.doctorName)
  const specialty = asText(intake.specialty)
  const sourceRaw = asText(intake.source) ?? asText(meta.source)
  const source = sourceRaw ? sourceRaw.charAt(0).toUpperCase() + sourceRaw.slice(1) : null
  const doctorLine = [doctor, specialty].filter(Boolean).join(' · ') || null

  const items: Array<{ icon: string; label: string; value: string; note: string }> = []
  if (reason)
    items.push({ icon: '🩺', label: t('patient.intake.reason'), value: reason, note: t('patient.intake.botCaptured') })
  if (preferred)
    items.push({ icon: '📅', label: t('patient.intake.preferred'), value: preferred, note: t('patient.intake.botBooking') })
  if (doctorLine)
    items.push({ icon: '👩‍⚕️', label: t('patient.intake.doctor'), value: doctorLine, note: t('patient.intake.botCaptured') })
  if (source)
    items.push({ icon: '💬', label: t('patient.intake.source'), value: source, note: t('patient.intake.firstContact') })

  return (
    <Section title={t('patient.intake')} icon="📋">
      {items.length === 0 ? (
        <EmptyState icon="📋" title={t('patient.intake.emptyTitle')} desc={t('patient.intake.emptyDesc')} />
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {items.map((it) => (
            <div key={it.label} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-50 text-sm text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
                {it.icon}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{it.label}</p>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{it.value}</p>
                <p className="text-[11px] text-gray-400">{it.note}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ── Timeline ─────────────────────────────────────────────────────────────────────
function TimelineSection({
  appointments,
  upcoming,
  past,
  language,
  readonlyConversation,
  readonlyMessages,
  readonlyLoading,
}: {
  appointments: Appointment[]
  upcoming: Appointment[]
  past: Appointment[]
  language: 'es' | 'en'
  readonlyConversation: Conversation | null
  readonlyMessages: Message[]
  readonlyLoading: boolean
}) {
  const { t } = useI18n()
  return (
    <Section
      title={t('patient.appointments')}
      icon="🗂️"
      action={
        appointments.length > 0 ? (
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
            {t('patient.apptCount', { count: appointments.length })}
          </span>
        ) : null
      }
    >
      {appointments.length === 0 ? (
        <EmptyState icon="📅" title={t('patient.noAppointments')} desc={t('patient.noAppointmentsDesc')} />
      ) : (
        <div className="space-y-5">
          {upcoming.length > 0 && (
            <TimelineGroup label={t('patient.upcoming')} appointments={upcoming} isPast={false} language={language} />
          )}
          {past.length > 0 && (
            <TimelineGroup label={t('patient.past')} appointments={past} isPast language={language} />
          )}
        </div>
      )}

      {/* Read-only past conversation (Decision 4) */}
      {readonlyConversation && (
        <div className="mt-4 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/40">
          <p className="mb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-gray-400">
            🔒 {t('patient.readonlyConvo')} ·{' '}
            {readonlyConversation.lastMessageAt
              ? formatDateTime(readonlyConversation.lastMessageAt, language)
              : CHANNEL_LABEL[readonlyConversation.channel]}
          </p>
          {readonlyLoading ? (
            <p className="text-xs text-gray-400">{t('common.loading')}</p>
          ) : readonlyMessages.length === 0 ? (
            <p className="text-xs text-gray-400">{t('patient.noMessages')}</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {readonlyMessages.slice(-8).map((m) => (
                <ReadonlyBubble key={m.id} message={m} language={language} />
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

function TimelineGroup({
  label,
  appointments,
  isPast,
  language,
}: {
  label: string
  appointments: Appointment[]
  isPast: boolean
  language: 'es' | 'en'
}) {
  const { t } = useI18n()
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <div className="relative pl-6">
        <span className="absolute bottom-1 left-[7px] top-1 w-0.5 bg-gray-200 dark:bg-gray-700" aria-hidden />
        {appointments.map((a) => {
          const reason = asText(a.notes)
          return (
            <div key={a.id} className="relative pb-4 last:pb-0">
              <span
                className={`absolute -left-6 top-1 h-4 w-4 rounded-full border-[3px] bg-white dark:bg-gray-900 ${dotClass(a, isPast)}`}
                aria-hidden
              />
              <p className="text-[11.5px] font-semibold text-gray-400">{formatDateTime(a.startTime, language)}</p>
              <div className="clinic-card mt-1 p-3">
                <div className="flex items-center justify-between gap-2.5">
                  <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    {reason ?? t('patient.apptNoReason')}
                  </p>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-bold ${APPT_BADGE[a.status]}`}>
                    {t(`appt.status.${a.status}` as const)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReadonlyBubble({ message, language }: { message: Message; language: 'es' | 'en' }) {
  const { t } = useI18n()
  const inbound = message.role === 'user'
  const isBot = message.role === 'assistant'
  const body =
    message.contentType === 'audio'
      ? `🎤 ${message.transcription ?? t('patient.voiceMessage')}`
      : message.contentType === 'image'
        ? `🖼 ${t('patient.imageMessage')}`
        : message.content
  return (
    <div
      className={`max-w-[80%] rounded-xl px-3 py-1.5 text-xs leading-snug ${
        inbound
          ? 'rounded-bl-sm border border-gray-200 bg-white text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200'
          : 'ml-auto rounded-br-sm border border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200'
      }`}
    >
      {isBot && (
        <span className="mb-0.5 flex items-center gap-1 text-[10px] font-bold text-sky-700 dark:text-sky-300">
          🤖 {t('patient.botFlag')}
        </span>
      )}
      <span className="whitespace-pre-wrap break-words">{body}</span>
      <span className="mt-1 block text-[10px] text-gray-400">{formatDateTime(message.createdAt, language)}</span>
    </div>
  )
}

// ── Summary ──────────────────────────────────────────────────────────────────────
function SummarySection({
  lastInteraction,
  nextAppointment,
  language,
}: {
  lastInteraction: string | null
  nextAppointment: Appointment | null
  language: 'es' | 'en'
}) {
  const { t } = useI18n()
  return (
    <Section title={t('patient.summary')} icon="✨">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="clinic-card p-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{t('patient.lastInteraction')}</p>
          <p className="mt-1 text-base font-bold text-gray-800 dark:text-gray-100">
            {lastInteraction ? relativeTime(lastInteraction) : t('patient.none')}
          </p>
        </div>
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 dark:border-sky-900 dark:bg-sky-950/40">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">{t('patient.nextAppointment')}</p>
          <p className="mt-1 text-base font-bold text-sky-700 dark:text-sky-300">
            {nextAppointment ? formatDateTime(nextAppointment.startTime, language) : t('patient.none')}
          </p>
        </div>
      </div>
    </Section>
  )
}

// ── Tags ─────────────────────────────────────────────────────────────────────────
function TagsSection({ tags, language, loading }: { tags: Tag[]; language: 'es' | 'en'; loading: boolean }) {
  const { t } = useI18n()
  return (
    <Section title={t('patient.tags')} icon="🏷️">
      {loading ? (
        <p className="text-sm text-gray-400">{t('common.loading')}</p>
      ) : tags.length === 0 ? (
        <EmptyState icon="🏷️" title={t('patient.noTags')} desc={t('patient.noTagsDesc')} />
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const known = TAG_TYPES.some((tt) => tt.name === tag.name)
              const color = known ? tagColor(tag.name) : tag.color
              return (
                <span
                  key={tag.id}
                  className="rounded-full border px-2.5 py-0.5 text-xs font-semibold"
                  style={{ backgroundColor: `${color}1a`, color, borderColor: `${color}40` }}
                >
                  {known ? tagLabel(tag.name, language) : tag.name}
                </span>
              )
            })}
          </div>
          <p className="mt-2.5 text-[11px] text-gray-400">{t('patient.tagsSafetyNote')}</p>
        </>
      )}
    </Section>
  )
}

// ── Internal notes (Req 13) ────────────────────────────────────────────────────────
function NotesSection({
  conversationId,
  patientId,
  notes,
  loading,
  team,
}: {
  conversationId: string
  patientId: string
  notes: Note[]
  loading: boolean
  team: ReturnType<typeof useTeam>
}) {
  const { t, language } = useI18n()
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')

  const addMutation = useMutation({
    mutationFn: (content: string) => api.post(`/conversations/${conversationId}/notes`, { content }),
    onSuccess: () => {
      setDraft('')
      qc.invalidateQueries({ queryKey: ['patient-notes', patientId] })
    },
  })

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const content = draft.trim()
    if (content) addMutation.mutate(content)
  }

  return (
    <Section
      title={t('patient.notes')}
      icon="🔐"
      action={
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {t('patient.notesPrivateBadge')}
        </span>
      }
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/60 dark:bg-amber-950/30">
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
          🔐 {t('patient.notesStaffOnly')}
        </p>

        {loading ? (
          <p className="text-sm text-gray-400">{t('common.loading')}</p>
        ) : notes.length === 0 ? (
          <p className="py-2 text-sm text-gray-400">{t('patient.noNotes')}</p>
        ) : (
          <ul className="divide-y divide-amber-200/60 dark:divide-amber-900/40">
            {notes.map((n) => {
              const author = team.find((m) => m.id === n.authorId)
              return (
                <li key={n.id} className="py-2 first:pt-0">
                  <p className="whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-100">{n.content}</p>
                  <p className="mt-1 text-[11px] text-gray-400">
                    — {author?.fullName ?? author?.email ?? t('patient.unknownAuthor')} ·{' '}
                    {formatDateTime(n.createdAt, language)}
                  </p>
                </li>
              )
            })}
          </ul>
        )}

        <form onSubmit={onSubmit} className="mt-2.5 flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t('patient.notePlaceholder')}
            className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-500 dark:border-gray-700 dark:bg-gray-900"
          />
          <button
            type="submit"
            disabled={addMutation.isPending || !draft.trim()}
            className="shrink-0 rounded-lg bg-sky-700 px-3.5 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:opacity-60"
          >
            {t('patient.noteAdd')}
          </button>
        </form>
        {addMutation.isError && (
          <p className="mt-1.5 text-[11px] font-medium text-rose-600 dark:text-rose-400">{t('patient.noteAddError')}</p>
        )}
      </div>
    </Section>
  )
}

// ── Conversation status (mode / assignment / urgency) ──────────────────────────────
function ConversationStatusSection({
  conversation,
  tags,
  team,
}: {
  conversation: Conversation | undefined
  tags: Tag[]
  team: ReturnType<typeof useTeam>
}) {
  const { t } = useI18n()
  if (!conversation) return null

  const human = conversationMode(conversation.status) === 'human'
  const assignee = conversation.assignedTo ? team.find((m) => m.id === conversation.assignedTo) : null
  const safety = assessSafety(tags.map((tg) => tg.name))
  const urgency =
    safety.level === 'critical' ? 'urgent' : safety.level === 'warning' ? 'attention' : 'routine'
  const urgencyClass =
    urgency === 'urgent'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
      : urgency === 'attention'
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'

  return (
    <Section title={t('patient.convStatus')} icon="⚙️">
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-500 dark:text-gray-400">{t('patient.handlingMode')}</span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold ${
              human
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
            }`}
          >
            {human ? `👤 ${t('patient.mode.human')}` : `🤖 ${t('patient.mode.bot')}`}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-500 dark:text-gray-400">{t('patient.assignedTo')}</span>
          <span className="font-semibold text-gray-800 dark:text-gray-100">
            {assignee?.fullName ?? assignee?.email ?? t('patient.unassigned')}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-gray-500 dark:text-gray-400">{t('patient.urgency')}</span>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${urgencyClass}`}>
            {t(`patient.urgency.${urgency}` as const)}
          </span>
        </div>
      </div>
    </Section>
  )
}

// ── Shared presentational primitives ───────────────────────────────────────────────
function Section({
  title,
  icon,
  action,
  children,
}: {
  title: string
  icon?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="clinic-card p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {icon && <span aria-hidden>{icon}</span>}
          {title}
        </h2>
        {action as never}
      </div>
      {children as never}
    </section>
  )
}

function Field({
  label,
  value,
  src,
  srcIcon,
  srcClass,
  valueClass,
  mono,
}: {
  label: string
  value: string
  src?: string
  srcIcon?: string
  srcClass?: string
  valueClass?: string
  mono?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p
        className={`break-words text-sm font-medium text-gray-800 dark:text-gray-100 ${valueClass ?? ''} ${
          mono ? 'font-mono' : ''
        }`}
      >
        {mono ? (
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            {value}
          </code>
        ) : (
          value
        )}
      </p>
      {src && (
        <p className={`mt-1 flex items-center gap-1.5 text-[11px] font-medium text-gray-400 ${srcClass ?? ''}`}>
          {srcIcon && <span aria-hidden>{srcIcon}</span>}
          {src}
        </p>
      )}
    </div>
  )
}

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-5 text-center dark:border-gray-700 dark:bg-gray-900/40">
      <div className="text-xl opacity-50" aria-hidden>
        {icon}
      </div>
      <p className="mt-1.5 text-sm font-semibold text-gray-600 dark:text-gray-300">{title}</p>
      {desc && <p className="mt-0.5 text-xs text-gray-400">{desc}</p>}
    </div>
  )
}

function CenteredState({
  icon,
  title,
  desc,
  action,
}: {
  icon: string
  title: string
  desc?: string
  action?: ReactNode
}) {
  return (
    <div className="clinic-card px-6 py-14 text-center">
      <div className="text-3xl opacity-60" aria-hidden>
        {icon}
      </div>
      <p className="mt-2 text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</p>
      {desc && <p className="mx-auto mt-1 max-w-sm text-xs text-gray-400">{desc}</p>}
      {action && <div className="mt-4">{action as never}</div>}
    </div>
  )
}

function LoadingState() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        <div className="clinic-card p-5">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 animate-pulse rounded-2xl bg-gray-200 dark:bg-gray-800" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800" />
            </div>
          </div>
          <div className="mt-5 space-y-2.5">
            <div className="h-3 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            <div className="h-3 w-11/12 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
          </div>
        </div>
        <div className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900" />
      </div>
      <div className="space-y-4">
        <div className="h-28 animate-pulse rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900" />
        <div className="h-40 animate-pulse rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900" />
      </div>
    </div>
  )
}
