'use client'

// Clinic staff need a first-glance answer to "what needs attention now?".
// This panel summarizes the live queue and today's appointments using the same
// APIs as Inbox and Calendar, then links directly into the next useful action.
import Link from 'next/link'
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useActiveClinic } from '../hooks/useActiveClinic'
import { useAuthStore } from '../store/auth'
import { can } from '../permissions'
import { assessSafety } from '../safety'
import { formatWaiting, waitingMinutes } from '../sla'
import type { AppointmentWithNames, Conversation } from '../types'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function timeOf(iso: string): string {
  return iso.slice(11, 16)
}

function patientLabel(c: Conversation): string {
  return c.patientName || c.channelContactHandle || 'Patient'
}

function isClosed(c: Conversation): boolean {
  return c.status === 'resolved' || c.status === 'archived'
}

export function TodayCommandCenter({ compact = false }: { compact?: boolean }) {
  const { clinicId } = useActiveClinic()
  const user = useAuthStore((s) => s.user)
  const canCalendar = can(user?.role, 'calendar')
  const today = todayISO()

  const conversationsQuery = useQuery({
    queryKey: ['today-command-conversations', clinicId, user?.id, user?.role],
    enabled: Boolean(clinicId),
    refetchInterval: 15_000,
    queryFn: () => {
      const params = new URLSearchParams()
      if (user?.role === 'doctor' && user.id) params.set('assigned_to', user.id)
      const qs = params.toString()
      return api.get<{ conversations: Conversation[] }>(`/conversations${qs ? `?${qs}` : ''}`)
    },
  })

  const appointmentsQuery = useQuery({
    queryKey: ['today-command-appointments', clinicId, today],
    enabled: Boolean(clinicId && canCalendar),
    refetchInterval: 60_000,
    queryFn: () => {
      const q = new URLSearchParams({ from: `${today}T00:00:00`, to: `${addDays(today, 1)}T00:00:00` })
      return api.get<{ appointments: AppointmentWithNames[] }>(`/clinics/${clinicId}/appointments?${q}`)
    },
  })

  const summary = useMemo(() => {
    const conversations = conversationsQuery.data?.conversations ?? []
    const open = conversations.filter((c) => !isClosed(c))
    const urgent = open.filter((c) => assessSafety(c.tags).level)
    const waiting = open
      .map((c) => ({
        conversation: c,
        minutes: waitingMinutes(c.lastMessageAt, c.lastMessage?.role ?? null),
      }))
      .filter((row): row is { conversation: Conversation; minutes: number } => row.minutes !== null)
      .sort((a, b) => b.minutes - a.minutes)
    const unassigned = open.filter((c) => !c.assignedTo && c.status !== 'snoozed')
    const botWatching = open.filter((c) => c.status === 'open')
    const appointments = (appointmentsQuery.data?.appointments ?? [])
      .filter((a) => !['cancelled', 'completed', 'no_show'].includes(a.status))
      .sort((a, b) => a.startTime.localeCompare(b.startTime))

    return {
      open,
      urgent,
      waiting,
      unassigned,
      botWatching,
      appointments,
      nextConversation: urgent[0] ?? waiting[0]?.conversation ?? unassigned[0] ?? open[0],
      nextAppointment: appointments.find((a) => a.startTime.slice(11, 16) >= new Date().toISOString().slice(11, 16)) ?? appointments[0],
    }
  }, [appointmentsQuery.data, conversationsQuery.data])

  const loading = conversationsQuery.isLoading || (canCalendar && appointmentsQuery.isLoading)
  const hasError = conversationsQuery.isError || appointmentsQuery.isError
  const next = summary.nextConversation

  return (
    <section className="clinic-card overflow-hidden">
      <div className={`clinic-section-surface flex flex-wrap items-start justify-between gap-3 border-x-0 border-t-0 ${compact ? 'p-3' : 'p-4'}`}>
        <div>
          <h2 className={`${compact ? 'text-sm' : 'text-lg'} font-bold text-gray-950 dark:text-gray-50`}>Today</h2>
          {!compact && <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            Urgent patient messages, waiting replies, unassigned work, and today's visits in one staff view.
          </p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link prefetch={false}
            href="/inbox"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            Open inbox
          </Link>
          {canCalendar && (
            <Link prefetch={false}
              href="/calendar"
              className="rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700"
            >
              View calendar
            </Link>
          )}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 p-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : hasError ? (
        <div className="p-4 text-sm text-red-600 dark:text-red-300">
          Could not load the live clinic summary. Inbox and calendar are still available.
        </div>
      ) : (
        <>
          <div className={`grid gap-3 ${compact ? 'p-3 sm:grid-cols-4' : 'p-4 sm:grid-cols-2 lg:grid-cols-4'}`}>
            <BriefMetric label="Needs attention" value={summary.urgent.length} tone={summary.urgent.length ? 'red' : 'green'} />
            <BriefMetric label="Waiting on staff" value={summary.waiting.length} tone={summary.waiting.length ? 'amber' : 'green'} />
            <BriefMetric label="Unassigned" value={summary.unassigned.length} tone={summary.unassigned.length ? 'indigo' : 'green'} />
            <BriefMetric label="Visits today" value={summary.appointments.length} tone="blue" />
          </div>

          <div className={`grid gap-3 border-t border-gray-200 ${compact ? 'p-3 lg:grid-cols-2' : 'p-4 lg:grid-cols-[1.1fr_0.9fr]'} dark:border-gray-800`}>
            <div className="clinic-nested-surface rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold">Next patient action</h3>
                {next && (
                  <Link prefetch={false} href={`/inbox?c=${next.id}`} className="text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400">
                    Open thread
                  </Link>
                )}
              </div>
              {next ? (
                <div className="mt-3 flex items-start gap-3">
                  <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${summary.urgent.includes(next) ? 'bg-red-500' : 'bg-amber-500'}`} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-950 dark:text-gray-50">{patientLabel(next)}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                      {summary.urgent.includes(next)
                        ? 'Safety or urgency signal detected. Review before the bot continues.'
                        : summary.waiting[0]?.conversation.id === next.id
                          ? `Patient has waited ${formatWaiting(summary.waiting[0].minutes)} for a reply.`
                          : next.status === 'open'
                            ? 'Bot is handling this thread. Keep an eye on it for escalation.'
                            : 'Thread is open and ready for staff review.'}
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No open patient conversations need staff action right now.</p>
              )}
            </div>

            <div className="clinic-nested-surface rounded-lg p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold">Next visit</h3>
                {canCalendar && (
                  <Link prefetch={false} href="/calendar" className="text-xs font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400">
                    Schedule
                  </Link>
                )}
              </div>
              {summary.nextAppointment ? (
                <div className="mt-3">
                  <p className="text-sm font-semibold text-gray-950 dark:text-gray-50">
                    {timeOf(summary.nextAppointment.startTime)} · {summary.nextAppointment.patientName || 'Patient'}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    {summary.nextAppointment.doctorName || 'No provider assigned'}
                    {summary.nextAppointment.serviceName ? ` · ${summary.nextAppointment.serviceName}` : ''}
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">No active visits are scheduled for today.</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

function BriefMetric({ label, value, tone }: { label: string; value: number; tone: 'red' | 'amber' | 'indigo' | 'blue' | 'green' }) {
  const toneClass = {
    red: 'bg-red-50 text-red-700 ring-red-100 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900',
    indigo: 'bg-teal-50 text-teal-700 ring-teal-100 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-900',
    blue: 'bg-sky-50 text-sky-700 ring-sky-100 dark:bg-sky-950/40 dark:text-sky-300 dark:ring-sky-900',
    green: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900',
  }[tone]

  return (
    <div className={`rounded-lg px-3 py-2 ring-1 ${toneClass}`}>
      <p className="crm-brief-metric-value font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-xs font-semibold uppercase text-current opacity-80">{label}</p>
    </div>
  )
}
