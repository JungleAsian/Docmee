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
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-gray-500">{t('assign.header')}:</span>
      <select
        value={conversation?.assignedTo ?? ''}
        onChange={(e) => {
          if (e.target.value) assignMutation.mutate(e.target.value)
        }}
        disabled={assignMutation.isPending}
        className="max-w-[10rem] truncate rounded-md border border-gray-300 px-2 py-1 text-xs outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
      >
        <option value="" disabled>
          {t('conv.unassigned')}
        </option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.fullName ?? m.email}
          </option>
        ))}
      </select>
    </label>
  )
}
