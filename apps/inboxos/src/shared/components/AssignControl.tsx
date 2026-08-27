'use client'

// Gap #24 — compact assignment dropdown shown in the ConversationView header.
// Mirrors the right-rail AssignPanel but inline; both invalidate the same queries
// so they stay in sync. Assigning is role-gated (secretary, doctor, clinic_admin —
// matching the assign API and the rest of the clinic-inbox actions); any other role
// sees the current assignee as read-only text.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useI18n } from '../hooks/useI18n'
import { useTeam } from '../hooks/useTeam'
import type { Conversation, TeamMember } from '../types'

const CAN_ASSIGN = new Set(['secretary', 'doctor', 'clinic_admin', 'ia_studio_admin'])
const NON_ADMIN_ASSIGNABLE_ROLES = new Set(['secretary', 'doctor'])

function assignableMembersForRole(members: TeamMember[], role: string | undefined): TeamMember[] {
  const active = members.filter((member) => member.status === 'active')
  if (role === 'clinic_admin' || role === 'ia_studio_admin') return active
  return active.filter((member) => (member.role ? NON_ADMIN_ASSIGNABLE_ROLES.has(member.role) : true))
}

export function AssignControl({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const canAssign = user ? CAN_ASSIGN.has(user.role) : false

  const conversationQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<{ conversation: Conversation }>(`/conversations/${conversationId}`),
  })
  const members = assignableMembersForRole(useTeam(canAssign), user?.role)

  const assignMutation = useMutation({
    mutationFn: (userId: string) => api.post(`/conversations/${conversationId}/assign`, { userId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })
  const conversation = conversationQuery.data?.conversation
  const assignee = members.find((m) => m.id === conversation?.assignedTo)
  const assigneeLabel = conversation?.assignedTo
    ? (assignee?.fullName ?? assignee?.email ?? conversation.assignedTo)
    : t('conv.unassigned')

  if (!canAssign) {
    return (
      <span className="text-xs text-gray-500">
        {t('assign.header')}: <span className="font-medium">{assigneeLabel}</span>
      </span>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs" aria-label="Conversation handling">
      <span className="rounded-full bg-emerald-100 px-2 py-1 font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
        {`● ${assigneeLabel}`}
      </span>
      <button
        type="button"
        onClick={() => user?.id && assignMutation.mutate(user.id)}
        disabled={assignMutation.isPending || !user?.id || conversation?.assignedTo === user.id}
        className="rounded-full border border-teal-600 px-2.5 py-1.5 font-semibold text-teal-700 hover:bg-teal-50 disabled:opacity-50 dark:text-teal-300 dark:hover:bg-teal-950/30"
      >
        {assignMutation.isPending ? 'Assigning…' : 'Assign to me'}
      </button>
    </div>
  )
}
