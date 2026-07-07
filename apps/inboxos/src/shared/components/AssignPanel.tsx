'use client'

// Gap #12 — Assignment panel. Shows the current assignee and lets a secretary,
// doctor or clinic_admin assign the conversation to themselves or another team
// member. The assign endpoint is role-gated (secretary, doctor, clinic_admin);
// any other role sees a read-only view.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { useAuthStore } from '../store/auth'
import { useI18n } from '../hooks/useI18n'
import { useActiveClinic } from '../hooks/useActiveClinic'
import type { Conversation, TeamMember } from '../types'

const CAN_ASSIGN = new Set(['secretary', 'doctor', 'clinic_admin', 'ia_studio_admin'])
const NON_ADMIN_ASSIGNABLE_ROLES = new Set(['secretary', 'doctor'])

function assignableMembersForRole(members: TeamMember[], role: string | undefined): TeamMember[] {
  const active = members.filter((member) => member.status === 'active')
  if (role === 'clinic_admin' || role === 'ia_studio_admin') return active
  return active.filter((member) => (member.role ? NON_ADMIN_ASSIGNABLE_ROLES.has(member.role) : true))
}

export function AssignPanel({ conversationId }: { conversationId: string }) {
  const { t } = useI18n()
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const { clinicId } = useActiveClinic()
  const canAssign = user ? CAN_ASSIGN.has(user.role) : false

  const conversationQuery = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => api.get<{ conversation: Conversation }>(`/conversations/${conversationId}`),
  })
  const teamQuery = useQuery({
    queryKey: ['team', clinicId],
    enabled: Boolean(clinicId) && canAssign,
    queryFn: () => api.get<{ members: TeamMember[] }>(`/clinics/${clinicId}/team`),
  })

  const assignMutation = useMutation({
    mutationFn: (userId?: string) =>
      api.post(`/conversations/${conversationId}/assign`, userId ? { userId } : {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['conversation', conversationId] })
      qc.invalidateQueries({ queryKey: ['conversations'] })
    },
  })

  const conversation = conversationQuery.data?.conversation
  const members = assignableMembersForRole(teamQuery.data?.members ?? [], user?.role)
  const assignee = members.find((m) => m.id === conversation?.assignedTo)
  const assigneeLabel = conversation?.assignedTo
    ? (assignee?.fullName ?? assignee?.email ?? conversation.assignedTo)
    : t('conv.unassigned')

  return (
    <section className="p-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{t('assign.title')}</h3>

      <p className="mb-2 text-xs">
        <span className="text-gray-400">{t('assign.current')}: </span>
        <span className="font-medium">{assigneeLabel}</span>
      </p>

      {!canAssign ? null : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => assignMutation.mutate(undefined)}
            disabled={assignMutation.isPending || conversation?.assignedTo === user?.id}
            className="w-full rounded-md bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {t('assign.toMe')}
          </button>

          <label className="block">
            <span className="sr-only">{t('assign.member')}</span>
            <select
              value={conversation?.assignedTo ?? ''}
              onChange={(e) => {
                if (e.target.value) assignMutation.mutate(e.target.value)
              }}
              disabled={assignMutation.isPending}
              className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-teal-500 dark:border-gray-700 dark:bg-gray-800"
            >
              <option value="" disabled>
                {t('assign.choose')}
              </option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.fullName ?? m.email}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  )
}
