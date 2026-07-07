import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runEscalationPass } from '../timeout-monitor.js'
import type { NotificationsRepository, UsersRepository, NotificationEvent } from '@docmee/db'
import type { NotificationStore } from '@docmee/notifications'

// A p1 alert created 30 min ago — well past ESCALATION_AFTER_MINUTES (15).
function staleP1Alert(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: 'alert-1',
    clinicId: 'c1',
    conversationId: 'conv-1',
    notificationType: 'email',
    recipient: 'secretary@c.com',
    subject: 'Emergency',
    content: '...',
    status: 'sent',
    sentAt: null,
    error: null,
    alertType: 'emergency',
    priority: 'p1',
    acknowledgedAt: null,
    metadata: {},
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    ...overrides,
  }
}

function makeStore(): { store: NotificationStore; created: Array<Record<string, unknown>> } {
  const created: Array<Record<string, unknown>> = []
  const store: NotificationStore = {
    create: vi.fn(async (input) => {
      created.push(input)
      return { id: `n${created.length}` }
    }),
    updateStatus: vi.fn(async () => {}),
  }
  return { store, created }
}

function makeRepos(opts: {
  escalatable: NotificationEvent[]
  alreadyEscalated?: boolean
  adminEmail?: string | null
}) {
  const notifications = {
    listEscalatable: vi.fn(async () => opts.escalatable),
    existsRecent: vi.fn(async () => opts.alreadyEscalated ?? false),
  } as unknown as NotificationsRepository
  const users = {
    findEmailByRole: vi.fn(async () => opts.adminEmail ?? null),
  } as unknown as UsersRepository
  return { notifications, users }
}

describe('runEscalationPass', () => {
  beforeEach(() => {
    process.env['LLM_STUB'] = 'true'
    delete process.env['ALERT_FALLBACK_EMAIL']
  })

  it('escalates an old, unacknowledged p1 alert to the clinic admin', async () => {
    const { notifications, users } = makeRepos({
      escalatable: [staleP1Alert()],
      adminEmail: 'admin@c.com',
    })
    const { store, created } = makeStore()

    await runEscalationPass(notifications, users, store)

    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      alertType: 'secretary_escalated',
      priority: 'p1',
      recipient: 'admin@c.com',
      conversationId: 'conv-1',
    })
  })

  it('does not escalate twice (dedup via existsRecent)', async () => {
    const { notifications, users } = makeRepos({
      escalatable: [staleP1Alert()],
      adminEmail: 'admin@c.com',
      alreadyEscalated: true,
    })
    const { store, created } = makeStore()

    await runEscalationPass(notifications, users, store)
    expect(created).toHaveLength(0)
  })

  it('skips when there is no new recipient (admin is the original, no fallback)', async () => {
    const { notifications, users } = makeRepos({
      escalatable: [staleP1Alert({ recipient: 'admin@c.com' })],
      adminEmail: 'admin@c.com',
    })
    const { store, created } = makeStore()

    await runEscalationPass(notifications, users, store)
    expect(created).toHaveLength(0)
  })

  it('falls back to ALERT_FALLBACK_EMAIL when there is no admin', async () => {
    process.env['ALERT_FALLBACK_EMAIL'] = 'ops@docmee.app'
    const { notifications, users } = makeRepos({
      escalatable: [staleP1Alert()],
      adminEmail: null,
    })
    const { store, created } = makeStore()

    await runEscalationPass(notifications, users, store)
    expect(created[0]).toMatchObject({ recipient: 'ops@docmee.app', alertType: 'secretary_escalated' })
  })
})
