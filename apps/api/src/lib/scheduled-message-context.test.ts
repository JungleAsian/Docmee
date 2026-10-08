import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadScheduledContext } from './scheduled-message-context.js'
import type { Sql } from '@docmee/db'
const fixture = vi.hoisted(() => ({
  clinic: { id: 'clinic', status: 'active', timezone: 'UTC', settings: { scheduledMessages: { enabled: true } } },
  conversation: { id: 'conversation', clinicId: 'clinic', patientId: 'patient', channel: 'whatsapp', channelContactHandle: 'synthetic-recipient', status: 'open' },
  patient: { id: 'patient', status: 'new', metadata: {} as Record<string, unknown> },
  author: { id: 'author', userId: 'account-user', status: 'active' },
  homeClinic: 'clinic',
  access: { permissions: ['inbox.view'], accessibleClinicIds: ['clinic'], isGlobalSuperAdmin: false },
  account: { id: 'account', clinicId: 'clinic', channel: 'whatsapp', accountId: 'provider-account', status: 'active', accessTokenEnc: 'synthetic-noncredential' },
}))
vi.mock('@docmee/db', () => ({
  createClinicsRepository: () => ({ findById: async () => fixture.clinic }),
  createConversationsRepository: () => ({ findById: async () => fixture.conversation, listTagsForPatient: async () => [] }),
  createPatientsRepository: () => ({ findById: async () => fixture.patient, listContacts: async () => [{ channel: 'whatsapp', contactHandle: 'synthetic-recipient' }] }),
  createUsersRepository: () => ({ findById: async (clinicId: string) => clinicId === fixture.homeClinic ? fixture.author : null, findIdentityById: async () => fixture.author }),
  createAccessRepository: () => ({ getEffectiveAccess: async () => fixture.access }),
  createChannelAccountsRepository: () => ({ listByClinic: async () => [fixture.account] }),
  createMessageTemplatesRepository: () => ({ findApprovedById: async () => null }),
  createScheduledMessagesRepository: () => ({ lastInboundAt: async () => '2026-10-07T12:00:00Z' }),
}))
const input = { clinicId: 'clinic', conversationId: 'conversation', authorId: 'author', kind: 'text' as const, expected: { patientId: 'patient', accountId: 'account', providerAccountId: 'provider-account', recipient: 'synthetic-recipient' } }
const sql = (() => Promise.resolve([{ providerAccountId: 'provider-account' }])) as unknown as Sql
describe('current scheduled context security boundary', () => {
  beforeEach(() => { fixture.homeClinic = 'clinic'; fixture.access.isGlobalSuperAdmin = false; fixture.access.accessibleClinicIds = ['clinic']; fixture.clinic.settings.scheduledMessages.enabled = true; fixture.conversation.status = 'open'; fixture.author.status = 'active'; fixture.patient.metadata = {}; fixture.account.accountId = 'provider-account'; fixture.access.permissions = ['inbox.view']; fixture.conversation.channelContactHandle = 'synthetic-recipient' })
  it('authorizes switched-clinic membership from the stable login identity, but blocks membership revocation', async () => {
    fixture.homeClinic = 'home-clinic'
    expect((await loadScheduledContext(sql, input)).reason).toBe(null)
    fixture.access.accessibleClinicIds = ['home-clinic']
    expect((await loadScheduledContext(sql, input)).reason).toBe('author_forbidden')
  })
  it('allows a current global administrator without a target clinic user row, but blocks revoked global access', async () => {
    fixture.homeClinic = 'home-clinic'; fixture.access.accessibleClinicIds = []; fixture.access.isGlobalSuperAdmin = true
    expect((await loadScheduledContext(sql, input)).reason).toBe(null)
    fixture.access.isGlobalSuperAdmin = false
    expect((await loadScheduledContext(sql, input)).reason).toBe('author_forbidden')
  })
  it('permits the original tenant/author/account/recipient only', async () => {
    expect((await loadScheduledContext(sql, input)).reason).toBe(null)
  })
  it.each([
    ['clinic_disabled', () => { fixture.clinic.settings.scheduledMessages.enabled = false }],
    ['author_forbidden', () => { fixture.author.status = 'inactive' }],
    ['author_forbidden', () => { fixture.access.permissions = [] }],
    ['opted_out', () => { fixture.patient.metadata = { optedOut: true } }],
    ['opted_out', () => { fixture.patient.metadata = { staffOptedOut: true } }],
    ['conversation_closed', () => { fixture.conversation.status = 'resolved' }],
    ['account_changed', () => { fixture.account.accountId = 'replacement' }],
    ['recipient_changed', () => { fixture.conversation.channelContactHandle = 'replacement' }],
  ] as const)('rejects %s on a current state change', async (reason, mutate) => {
    mutate(); expect((await loadScheduledContext(sql, input)).reason).toBe(reason)
  })
})
