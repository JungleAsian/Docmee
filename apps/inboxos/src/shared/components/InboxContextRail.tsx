'use client'

// Inbox redesign (#1–#3) — the right context rail. Always visible: the patient
// information card and the appointment-booking calendar. Everything else the rail
// used to stack (safety/handoff, assignment, lifecycle, tags, AI assistant,
// internal notes) now lives behind a collapsible "Others" section so the rail
// stays focused on the two things a secretary reaches for most.
import { useRef, useState } from 'react'
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

export function InboxContextRail({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()
  const role = useAuthStore((s) => s.user?.role)
  const [bookingOpen, setBookingOpen] = useState(false)
  const [othersOpen, setOthersOpen] = useState(false)
  const bookingRef = useRef<HTMLElement>(null)

  const openBooking = () => {
    setBookingOpen(true)
    // Let the section expand before scrolling it into view.
    requestAnimationFrame(() => bookingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <PatientInfoCard conversationId={conversationId} onSchedule={openBooking} />

      <AppointmentBookingCard
        ref={bookingRef}
        conversationId={conversationId}
        expanded={bookingOpen}
        onToggle={() => setBookingOpen((v) => !v)}
      />

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
            <SafetyHandoffPanel key={`safety-${conversationId}`} conversationId={conversationId} />
            <AssignPanel key={`assign-${conversationId}`} conversationId={conversationId} />
            <LifecyclePanel key={`lifecycle-${conversationId}`} conversationId={conversationId} />
            <TagsPanel key={`tags-${conversationId}`} conversationId={conversationId} />
            {can(role, 'assistant') && (
              <AssistantPanel key={`assistant-${conversationId}`} conversationId={conversationId} />
            )}
            <NotesPanel key={`notes-${conversationId}`} conversationId={conversationId} />
          </div>
        )}
      </section>
    </div>
  )
}
