import { createClinicsRepository, createConversationsRepository, createPatientsRepository, createUsersRepository, createAccessRepository, createChannelAccountsRepository, createMessageTemplatesRepository, createScheduledMessagesRepository, type Sql, type ScheduledMessage } from '@docmee/db'
import { isSafeScheduledTemplate, scheduledMessagesEnabled } from '@docmee/shared'

export interface ScheduledContextInput {
  clinicId: string; conversationId: string; authorId: string; kind: 'text' | 'template'; templateId?: string | null
  expected?: Pick<ScheduledMessage, 'patientId' | 'accountId' | 'providerAccountId' | 'recipient'>
}
export async function loadScheduledContext(sql: Sql, input: ScheduledContextInput) {
  const { clinicId, conversationId, authorId } = input
  const clinic = await createClinicsRepository(sql).findById(clinicId)
  const conversation = await createConversationsRepository(sql).findById(clinicId, conversationId)
  const base = { clinic, conversation, account: null, template: null, content: '', lastInboundAt: null as string | null }
  if (!clinic || clinic.status !== 'active') return { ...base, reason: 'clinic_inactive' }
  if (!scheduledMessagesEnabled(clinic.settings)) return { ...base, reason: 'clinic_disabled' }
  if (!conversation) return { ...base, reason: 'conversation_missing' }
  if (conversation.channel !== 'whatsapp') return { ...base, reason: 'channel_unsupported' }
  if (conversation.status === 'resolved' || conversation.status === 'archived') return { ...base, reason: 'conversation_closed' }
  // JWT authorId is the original login row, not necessarily a target-clinic row.
  // Keep that durable identity, then resolve CURRENT target membership/global access.
  const author = await createUsersRepository(sql).findIdentityById(authorId)
  if (!author || author.status !== 'active') return { ...base, reason: 'author_forbidden' }
  const access = await createAccessRepository(sql).getEffectiveAccess(author.userId, clinicId)
  if (!access.permissions.includes('inbox.view') || (!access.isGlobalSuperAdmin && !access.accessibleClinicIds.includes(clinicId))) return { ...base, reason: 'author_forbidden' }
  if (!conversation.patientId || (input.expected && conversation.patientId !== input.expected.patientId)) return { ...base, reason: 'patient_changed' }
  const patient = await createPatientsRepository(sql).findById(clinicId, conversation.patientId)
  if (!patient || patient.status === 'archived') return { ...base, reason: 'patient_unavailable' }
  const tags = await createConversationsRepository(sql).listTagsForPatient(clinicId, patient.id)
  if (patient.metadata['optedOut'] === true || patient.metadata['staffOptedOut'] === true || tags.some((t) => t.name === 'opted_out')) return { ...base, reason: 'opted_out' }
  const contacts = await createPatientsRepository(sql).listContacts(clinicId, patient.id)
  if ((input.expected && conversation.channelContactHandle !== input.expected.recipient) || !contacts.some((c) => c.channel === 'whatsapp' && c.contactHandle === conversation.channelContactHandle)) return { ...base, reason: 'recipient_changed' }
  // Legacy inbound rows without account evidence cannot borrow another account's care window.
  const origin = await sql<{ providerAccountId: string | null }[]>`SELECT metadata->>'phoneNumberId' AS provider_account_id FROM conversation_messages
    WHERE clinic_id = ${clinicId} AND conversation_id = ${conversationId} AND role = 'user' ORDER BY created_at DESC LIMIT 1`
  const providerAccountId = origin[0]?.providerAccountId
  if (!providerAccountId) return { ...base, reason: 'account_origin_unknown' }
  const accounts = await createChannelAccountsRepository(sql).listByClinic(clinicId)
  const account = accounts.find((a) => a.channel === 'whatsapp' && a.accountId === providerAccountId && a.status === 'active')
  if (!account || (input.expected && (account.id !== input.expected.accountId || account.accountId !== input.expected.providerAccountId))) return { ...base, reason: 'account_changed' }
  if (!account.accessTokenEnc) return { ...base, reason: 'account_unavailable' }
  const template = input.kind === 'template' && input.templateId ? await createMessageTemplatesRepository(sql).findApprovedById(clinicId, input.templateId) : null
  if (input.kind === 'template' && !isSafeScheduledTemplate(template)) return { ...base, account, reason: 'template_unsafe' }
  const lastInboundAt = await createScheduledMessagesRepository(sql).lastInboundAt(clinicId, patient.id, conversation.channelContactHandle, providerAccountId)
  return { ...base, account, template, content: template?.body ?? '', lastInboundAt, reason: null }
}
export type ScheduledContext = Awaited<ReturnType<typeof loadScheduledContext>>
