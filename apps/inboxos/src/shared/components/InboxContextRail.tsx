'use client'

// Inbox redesign (#1–#3) — the right context rail. Always visible: the patient
// information card and the appointment-booking calendar. Everything else the rail
// used to stack (safety/handoff, assignment, lifecycle, tags, AI assistant,
// internal notes) now lives behind a collapsible "Others" section so the rail
// stays focused on the two things a secretary reaches for most.
import { useState } from 'react'
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
import { CustomTagManager } from './CustomTagManager'
import { useI18n } from '../hooks/useI18n'
import { useAuthStore } from '../store/auth'
import { can } from '../permissions'
import { readInboxSettings } from '../inboxSettings'
import { useFeatures } from '../hooks/useFeatures'
import type { Clinic } from '../types'

export function InboxContextRail({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()
  const role = useAuthStore((s) => s.user?.role)
  const { features } = useFeatures()
  const clinicId = useAuthStore((s) => s.user?.clinicId)
  const clinicQuery = useQuery({
    queryKey: ['clinic', clinicId],
    enabled: Boolean(clinicId),
    queryFn: () => api.get<{ clinic: Clinic }>(`/clinics/${clinicId}`),
  })
  const inboxSettings = readInboxSettings(features.inboxLayoutV2 ? clinicQuery.data?.clinic.settings : undefined)
  const visibility = inboxSettings.patientChatVisibility
  const [othersOpen, setOthersOpen] = useState(false)
  return (
    <div className="flex flex-col gap-3 p-3">
      <PatientInfoCard
        conversationId={conversationId}
        showNextAppointment={visibility.nextAppointment}
        showAppointmentDateTime={visibility.appointmentDateTime}
        showPatientHistory={visibility.patientHistory}
        showChatStatus={visibility.chatStatus}
      />

      {features.calendarPolicyV2 && <AppointmentBookingCard
        conversationId={conversationId}
      />}

      {features.inboxLayoutV2 && can(role, 'studio') && clinicQuery.data?.clinic && <CustomTagManager clinic={clinicQuery.data.clinic} />}

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
            {visibility.assignee && visibility.assignControls && <AssignPanel key={`assign-${conversationId}`} conversationId={conversationId} />}
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
