import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  accounts: [{ status: 'active' }] as Array<{ status: string }>,
  snapshot: null as { issueKeys: string[] } | null,
  notifications: [] as Array<Record<string, unknown>>,
}))

const workflow = {
  id: 'w1',
  name: 'Booking',
  status: 'published',
  activeRevisionId: null,
  nodes: [
    { id: 't', kind: 'trigger', type: 'trigger.message_keyword', config: { keywords: 'cita' }, x: 0, y: 0 },
    { id: 'm', kind: 'action', type: 'action.send_message', config: { text: 'Hola' }, x: 0, y: 0 },
    { id: 'e', kind: 'action', type: 'action.end', config: {}, x: 0, y: 0 },
  ],
  edges: [{ id: 'e1', source: 't', target: 'm' }, { id: 'e2', source: 'm', target: 'e' }],
}

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createClinicsRepository: () => ({ findById: async (id: string) => ({ id, name: 'Derma Paz', settings: h.settings }) }),
  createChannelAccountsRepository: () => ({ listByClinic: async () => h.accounts }),
  createWorkflowsRepository: () => ({ listByClinic: async () => [workflow], findRevision: async () => null }),
  createDoctorsRepository: () => ({ listByClinic: async () => [] }),
  createMessageTemplatesRepository: () => ({ listApproved: async () => [] }),
  createClinicSetupChecksRepository: () => ({
    get: async () => h.snapshot,
    save: async (_clinicId: string, issueKeys: string[]) => { h.snapshot = { issueKeys } },
  }),
  createNotificationsRepository: () => ({ create: async (input: Record<string, unknown>) => { h.notifications.push(input) } }),
  normalizeWorkflowStatus: (status: string) => status,
}))
vi.mock('@docmee/agents', async () => ({
  ...(await import('../../../../packages/agents/src/workflows/clinic-setup-check.js')),
}))

import { recheckAndNotify, runSetupCheck } from '../lib/setup-check.js'

describe('clinic setup check (server)', () => {
  beforeEach(() => {
    h.settings = {}
    h.accounts = [{ status: 'active' }]
    h.snapshot = null
    h.notifications = []
  })

  it('reports that workflows never run when business hours are missing', async () => {
    const issues = await runSetupCheck('c1')
    expect(issues.map((issue) => issue.code)).toEqual(['workflows_never_run'])
  })

  it('notifies clinic admins about a new problem exactly once', async () => {
    const first = await recheckAndNotify('c1', 'admin@clinic.test')
    expect(first.map((issue) => issue.code)).toEqual(['workflows_never_run'])
    expect(h.notifications).toHaveLength(1)
    expect(h.notifications[0]).toMatchObject({
      clinicId: 'c1',
      notificationType: 'in_app',
      alertType: 'setup_error',
      recipient: 'clinic_admins',
      subject: 'Workflows will never answer patients',
      status: 'sent',
    })
    expect((h.notifications[0]!['metadata'] as Record<string, unknown>)['afterChangeBy']).toBe('admin@clinic.test')

    const second = await recheckAndNotify('c1', 'admin@clinic.test')
    expect(second).toEqual([])
    expect(h.notifications).toHaveLength(1)
  })

  it('notifies when a later change introduces a different problem', async () => {
    await recheckAndNotify('c1', null)
    h.settings = { businessHours: { monday: { open: '09:00', close: '18:00', closed: false } } }
    h.accounts = [{ status: 'error' }]
    const fresh = await recheckAndNotify('c1', null)
    expect(fresh.map((issue) => issue.code)).toEqual(['no_active_channel', 'workflows_after_hours_only'])
    expect(h.notifications.map((n) => n['alertType'])).toEqual(['setup_error', 'setup_error', 'setup_warning'])
  })

  it('stays quiet when the clinic is configured correctly', async () => {
    h.settings = { businessHours: { monday: { open: '09:00', close: '18:00', closed: false } }, automationDuringBusinessHours: true }
    expect(await recheckAndNotify('c1', null)).toEqual([])
    expect(h.notifications).toEqual([])
  })
})
