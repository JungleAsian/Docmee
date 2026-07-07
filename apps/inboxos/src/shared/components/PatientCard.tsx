'use client'

// Patient identity card — the top of the inbox context pane. Shows who the
// secretary is talking to (avatar + name + channel handle) and, crucially, the
// returning-patient signal (Req 16): a known patient is reassuringly distinct from a
// brand-new first contact at a glance. Reuses the ['conversation', id] and
// ['patient', id] queries (TanStack dedupes them) so it never adds a fetch.
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { useI18n } from '../hooks/useI18n'
import { avatarLabel } from '../format'
import type { Channel, Conversation, Patient, PatientStatus } from '../types'

const CHANNEL_LABEL: Record<Channel, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
}

// Req 16 — 'returning' is the reassuring positive case (teal, starred); 'new' is a
// neutral first-contact note; 'archived' is muted.
const STATUS_BADGE: Record<PatientStatus, { className: string; glyph: string }> = {
  new: { className: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300', glyph: '✦' },
  returning: {
    className: 'bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300',
    glyph: '★',
  },
  archived: { className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', glyph: '◦' },
}

export function PatientCard({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()

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

  const handle = conversation?.channelContactHandle ?? '…'
  const displayName = patient?.fullName ?? handle
  const badge = patient ? STATUS_BADGE[patient.status] : null

  return (
    <section className="border-b border-[var(--crm-border-color)] px-5 py-5 text-center">
      <div className="crm-conv-avatar mx-auto !h-20 !w-20 !text-2xl">
        {avatarLabel(handle)}
      </div>
      <p className="mt-3 text-[16px] font-extrabold text-[var(--crm-text-main)]">{displayName}</p>
      {patient?.fullName && <p className="text-xs text-[var(--crm-text-muted)]">{handle}</p>}
      {conversation && (
        <p className="mt-0.5 text-[11px] font-semibold text-[var(--crm-text-muted)]">{CHANNEL_LABEL[conversation.channel]}</p>
      )}
      {badge && (
        <span
          className={`mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badge.className}`}
        >
          {badge.glyph} {t(`patient.status.${patient!.status}` as const)}
        </span>
      )}
      {patientId && (
        <div className="mt-2">
          <Link
            href={`/inbox/${conversationId}/patient`}
            className="text-[11px] font-bold text-[var(--crm-primary-color)] hover:underline"
          >
            {t('patient.title')} →
          </Link>
        </div>
      )}
    </section>
  )
}
