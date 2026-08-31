'use client'

// Inbox redesign (#1–#3) — the right context rail. Always visible: the patient
// information card and the appointment-booking calendar. Everything else the rail
// used to stack (safety/handoff, assignment, lifecycle, tags, AI assistant,
// internal notes) now lives behind a collapsible "Others" section so the rail
// stays focused on the two things a secretary reaches for most.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { useUserUiPreferences } from '../hooks/useUserUiPreferences'
import { visibleOrderedItems } from '../userUiPreferences'
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
  const { preferences } = useUserUiPreferences()
  const appointmentRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const focusCalendar = () => {
      appointmentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      appointmentRef.current?.focus({ preventScroll: true })
    }
    window.addEventListener('docmee:focus-scheduling', focusCalendar)
    return () => window.removeEventListener('docmee:focus-scheduling', focusCalendar)
  }, [])

  const mainPanels = useMemo(() => {
    const panels: Record<string, ReactNode> = {
      patient: (
        <PatientInfoCard
          key="patient"
          conversationId={conversationId}
          showNextAppointment={visibility.nextAppointment}
          showAppointmentDateTime={visibility.appointmentDateTime}
          showPatientHistory={visibility.patientHistory}
          showChatStatus={visibility.chatStatus}
        />
      ),
      notes: inboxSettings.inboxLayout.internalNotesVisible ? (
        <NotesPanel key={`notes-${conversationId}`} conversationId={conversationId} />
      ) : null,
      others: <></>,
    }

    if (features.calendarPolicyV2) {
      panels.calendar = (
        <AppointmentBookingCard
          key="calendar"
          ref={appointmentRef}
          conversationId={conversationId}
        />
      )
    }

    const allowed = features.calendarPolicyV2
      ? ['patient', 'calendar', 'notes', 'others']
      : ['patient', 'notes', 'others']
    return visibleOrderedItems(preferences.sideRailItemOrder.main, allowed, preferences.hiddenSideRailItems)
      .map((id) => [id, panels[id]] as const)
      .filter((entry): entry is readonly [string, ReactNode] => Boolean(entry[1]))
  }, [conversationId, features.calendarPolicyV2, inboxSettings.inboxLayout.internalNotesVisible, preferences.hiddenSideRailItems, preferences.sideRailItemOrder.main, visibility.appointmentDateTime, visibility.chatStatus, visibility.nextAppointment, visibility.patientHistory])

  const othersItems = visibleOrderedItems(
    preferences.sideRailItemOrder.others,
    ['customTags', 'safetyHandoff', 'assign', 'lifecycle', 'tags', 'aiAssistance'],
    preferences.hiddenSideRailItems,
  )

  return (
    <div className="flex flex-col gap-3 p-3">
      {mainPanels.map(([id, panel]) => id === 'others' ? (
        <OthersPanel
          key={id}
          t={t}
          open={othersOpen}
          onToggle={() => setOthersOpen((v) => !v)}
        >
          {othersItems.map((item) => {
            if (item === 'customTags') {
              return features.inboxLayoutV2 && can(role, 'studio') && clinicQuery.data?.clinic ? (
                <CustomTagManager key="customTags" clinic={clinicQuery.data.clinic} />
              ) : null
            }
            if (item === 'safetyHandoff') return visibility.safetyHandoff ? <SafetyHandoffPanel key={`safety-${conversationId}`} conversationId={conversationId} /> : null
            if (item === 'assign') return visibility.assignee && visibility.assignControls ? <AssignPanel key={`assign-${conversationId}`} conversationId={conversationId} /> : null
            if (item === 'lifecycle') return visibility.lifecycleStatus ? <LifecyclePanel key={`lifecycle-${conversationId}`} conversationId={conversationId} /> : null
            if (item === 'tags') return visibility.tags ? <TagsPanel key={`tags-${conversationId}`} conversationId={conversationId} /> : null
            if (item === 'aiAssistance') {
              return visibility.aiAssistance && can(role, 'assistant') ? (
                <AssistantPanel key={`assistant-${conversationId}`} conversationId={conversationId} />
              ) : null
            }
            return null
          })}
        </OthersPanel>
      ) : panel)}
    </div>
  )
}

function OthersPanel({
  t,
  open,
  onToggle,
  children,
}: {
  t: (key: 'inbox.others') => string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <section className="rounded-[var(--crm-border-radius-md)] border border-[var(--crm-border-color)] bg-[var(--crm-card-bg)] shadow-[var(--crm-shadow-sm)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--crm-text-muted)]">
          {t('inbox.others')}
        </span>
        <span aria-hidden className="text-[var(--crm-text-muted)]">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="crm-inbox-others border-t border-[var(--crm-border-color)]">
          {children}
        </div>
      )}
    </section>
  )
}
