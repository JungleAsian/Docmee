'use client'

// Inbox redesign (#1–#3) — the right context rail. Always visible: the patient
// information card and the appointment-booking calendar. Everything else the rail
// used to stack (safety/handoff, assignment, lifecycle, tags, AI assistant,
// internal notes) now lives behind a collapsible "Others" section so the rail
// stays focused on the two things a secretary reaches for most.
import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { PatientInfoCard } from './PatientInfoCard'
import { AppointmentBookingCard } from './AppointmentBookingCard'
import { SafetyHandoffPanel } from './SafetyHandoffPanel'
import { LifecyclePanel } from './LifecyclePanel'
import { AssignPanel } from './AssignPanel'
import { TagsPanel } from './TagsPanel'
import { NotesPanel } from './NotesPanel'
import { AssistantPanel } from './AssistantPanel'
import { useI18n } from '../hooks/useI18n'
import { useAuthStore } from '../store/auth'
import { can } from '../permissions'

// Keep the UI reader dependency-free; the API/workers use the canonical shared
// contract, while this tolerant reader prevents an older clinic settings blob
// from making the Inbox crash during staged rollout.
const readInboxSettings = (settings: Record<string, unknown> | null | undefined) => {
  const layout = (settings?.inboxLayout && typeof settings.inboxLayout === 'object' ? settings.inboxLayout : {}) as Record<string, unknown>
  const visibility = (settings?.patientChatVisibility && typeof settings.patientChatVisibility === 'object' ? settings.patientChatVisibility : {}) as Record<string, unknown>
  const keys = ['safetyHandoff', 'lifecycleStatus', 'tags', 'aiAssistance', 'inactiveChannels', 'assignee', 'assignControls', 'patientHistory', 'chatStatus', 'nextAppointment', 'appointmentDateTime'] as const
  return {
    inboxLayout: { calendarExpanded: layout.calendarExpanded !== false, internalNotesVisible: layout.internalNotesVisible !== false },
    patientChatVisibility: Object.fromEntries(keys.map((key) => [key, visibility[key] === undefined ? true : visibility[key] === true])) as Record<(typeof keys)[number], boolean>,
  }
}

export function InboxContextRail({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()
  const role = useAuthStore((s) => s.user?.role)
  const clinicId = useAuthStore((s) => s.user?.clinicId)
  const clinicQuery = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: { settings?: Record<string, unknown> | null } }>(`/clinics/${clinicId}`),
  })
  const inboxSettings = readInboxSettings(clinicQuery.data?.clinic.settings)
  const visibility = inboxSettings.patientChatVisibility
  const [othersOpen, setOthersOpen] = useState(false)
  const bookingRef = useRef<HTMLElement>(null)

  const openBooking = () => {
    // Let the section expand before scrolling it into view.
    requestAnimationFrame(() => bookingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <PatientInfoCard
        conversationId={conversationId}
        onSchedule={openBooking}
        showNextAppointment={visibility.nextAppointment}
        showAppointmentDateTime={visibility.appointmentDateTime}
        showPatientHistory={visibility.patientHistory}
      />

      <AppointmentBookingCard
        ref={bookingRef}
        conversationId={conversationId}
      />

      {inboxSettings.inboxLayout.internalNotesVisible && <NotesPanel key={`notes-${conversationId}`} conversationId={conversationId} />}

      {/* Others — everything the rail used to show, now collapsed by default. */}
      <section className="rounded-[var(--crm-border-radius-md)] border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] shadow-[var(--crm-shadow-sm)]">
        <button
          type="button"
          onClick={() => setOthersOpen((v) => !v)}
          aria-expanded={othersOpen}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-[var(--crm-text-muted)]">
            {t('inbox.others')}
          </span>
          <span aria-hidden className="text-[var(--crm-text-muted)]">
            {othersOpen ? '▾' : '▸'}
          </span>
        </button>
        {othersOpen && (
          <div className="crm-inbox-others border-t border-[var(--crm-border-color)]">
            {visibility.safetyHandoff && <SafetyHandoffPanel key={`safety-${conversationId}`} conversationId={conversationId} />}
            {visibility.assignee && <AssignPanel key={`assign-${conversationId}`} conversationId={conversationId} />}
            {visibility.lifecycleStatus && <LifecyclePanel key={`lifecycle-${conversationId}`} conversationId={conversationId} />}
            {visibility.tags && <TagsPanel key={`tags-${conversationId}`} conversationId={conversationId} />}
            {visibility.aiAssistance && can(role, 'assistant') && (
              <AssistantPanel key={`assistant-${conversationId}`} conversationId={conversationId} />
            )}
          </div>
        )}
      </section>
    </div>
  )
}
