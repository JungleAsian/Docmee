import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dispatchNotification, type NotificationStore } from '../dispatcher.js'
import type { SendEmailParams } from '../channels/email.channel.js'
import { buildNotificationEmail } from '../templates.js'
import { NOTIFICATION_TYPES } from '../notification-types.js'

function makeStore() {
  const created: Array<Record<string, unknown>> = []
  const statuses: Array<{ id: string; status: string; error?: string | null }> = []
  const store: NotificationStore = {
    create: vi.fn(async (input) => {
      created.push(input)
      return { id: `n${created.length}` }
    }),
    updateStatus: vi.fn(async (id, status, error) => {
      statuses.push({ id, status, error })
    }),
  }
  return { store, created, statuses }
}

describe('dispatchNotification', () => {
  beforeEach(() => {
    process.env['LLM_STUB'] = 'true'
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('LLM_STUB=true → real sendEmail is skipped but the DB entry is still created', async () => {
    const { store, created, statuses } = makeStore()
    // No injected sendEmail → uses the real resend-backed one, which short-circuits on LLM_STUB.
    await dispatchNotification(
      { clinicId: 'c1', type: NOTIFICATION_TYPES.NEW_PATIENT, recipientEmail: 'a@b.com' },
      { store },
    )
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ clinicId: 'c1', recipient: 'a@b.com', status: 'pending' })
    // Delivery still "succeeds" (skipped, no throw) → status flips to sent.
    expect(statuses).toEqual([{ id: 'n1', status: 'sent', error: undefined }])
  })

  it('emergency type → priority p1 is persisted', async () => {
    const { store, created } = makeStore()
    await dispatchNotification(
      { clinicId: 'c1', type: NOTIFICATION_TYPES.EMERGENCY, recipientEmail: 'a@b.com' },
      { store },
    )
    expect(created[0]).toMatchObject({ alertType: 'emergency', priority: 'p1' })
  })

  it('sends the templated email through the injected sender', async () => {
    const { store } = makeStore()
    const sent: SendEmailParams[] = []
    const sendEmail = vi.fn(async (params: SendEmailParams) => {
      sent.push(params)
    })
    await dispatchNotification(
      { clinicId: 'c1', type: NOTIFICATION_TYPES.BOOKING_CONFIRMED, recipientEmail: 'a@b.com' },
      { store, sendEmail },
    )
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sent[0]!.to).toBe('a@b.com')
    expect(sent[0]!.subject).toContain('Appointment confirmed')
  })

  it('delivery failure → status failed, but never throws', async () => {
    const { store, statuses } = makeStore()
    const sendEmail = vi.fn(async () => {
      throw new Error('resend down')
    })
    await expect(
      dispatchNotification(
        { clinicId: 'c1', type: NOTIFICATION_TYPES.EMERGENCY, recipientEmail: 'a@b.com' },
        { store, sendEmail },
      ),
    ).resolves.toBeUndefined()
    expect(statuses).toEqual([{ id: 'n1', status: 'failed', error: 'resend down' }])
  })

  it('online recipient + standard alert → panel-only (no email), channel in_app, status sent', async () => {
    const { store, created, statuses } = makeStore()
    const sendEmail = vi.fn(async () => {})
    await dispatchNotification(
      {
        clinicId: 'c1',
        type: NOTIFICATION_TYPES.CONVERSATION_ASSIGNED,
        recipientEmail: 'a@b.com',
        recipientOnline: true,
      },
      { store, sendEmail },
    )
    expect(sendEmail).not.toHaveBeenCalled()
    expect(created[0]).toMatchObject({ notificationType: 'in_app', priority: 'standard' })
    expect(statuses).toEqual([{ id: 'n1', status: 'sent', error: undefined }])
  })

  it('online recipient + p1 alert → still emails (channel email)', async () => {
    const { store, created } = makeStore()
    const sendEmail = vi.fn(async () => {})
    await dispatchNotification(
      {
        clinicId: 'c1',
        type: NOTIFICATION_TYPES.UPSET_PATIENT,
        recipientEmail: 'a@b.com',
        recipientOnline: true,
      },
      { store, sendEmail },
    )
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(created[0]).toMatchObject({ notificationType: 'email', priority: 'p1' })
  })

  it('offline recipient + standard alert → emails (channel email)', async () => {
    const { store, created } = makeStore()
    const sendEmail = vi.fn(async () => {})
    await dispatchNotification(
      {
        clinicId: 'c1',
        type: NOTIFICATION_TYPES.CONVERSATION_ASSIGNED,
        recipientEmail: 'a@b.com',
        recipientOnline: false,
      },
      { store, sendEmail },
    )
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(created[0]).toMatchObject({ notificationType: 'email' })
  })

  it('offline recipient + muted (emailAllowed=false) non-urgent alert → panel only, no email', async () => {
    const { store, created, statuses } = makeStore()
    const sendEmail = vi.fn(async () => {})
    await dispatchNotification(
      {
        clinicId: 'c1',
        type: NOTIFICATION_TYPES.NEW_PATIENT,
        recipientEmail: 'a@b.com',
        recipientOnline: false,
        emailAllowed: false,
      },
      { store, sendEmail },
    )
    expect(sendEmail).not.toHaveBeenCalled()
    expect(created[0]).toMatchObject({ notificationType: 'in_app', priority: 'p2' })
    expect(statuses).toEqual([{ id: 'n1', status: 'sent', error: undefined }])
  })

  it('emailAllowed=false NEVER suppresses a p1 alert (safety override)', async () => {
    const { store, created } = makeStore()
    const sendEmail = vi.fn(async () => {})
    await dispatchNotification(
      {
        clinicId: 'c1',
        type: NOTIFICATION_TYPES.EMERGENCY,
        recipientEmail: 'a@b.com',
        recipientOnline: true,
        emailAllowed: false,
      },
      { store, sendEmail },
    )
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(created[0]).toMatchObject({ notificationType: 'email', priority: 'p1' })
  })

  it('pushes to every device when push deps are supplied (independent of email routing)', async () => {
    const { store } = makeStore()
    const sendEmail = vi.fn(async () => {})
    const pushed: Array<{ endpoint: string; payload: string }> = []
    const send = vi.fn(async (sub: { endpoint: string }, payload: string) => {
      pushed.push({ endpoint: sub.endpoint, payload })
      return { ok: true, status: 201, expired: false }
    })
    const subs = [
      { endpoint: 'https://push.test/a', keys: { p256dh: 'x', auth: 'y' } },
      { endpoint: 'https://push.test/b', keys: { p256dh: 'x', auth: 'y' } },
    ]
    await dispatchNotification(
      {
        clinicId: 'c1',
        conversationId: 'conv-9',
        type: NOTIFICATION_TYPES.CONVERSATION_ASSIGNED,
        recipientEmail: 'a@b.com',
        recipientOnline: true, // panel-only for email; push still fires
      },
      {
        store,
        sendEmail,
        push: { subscriptions: subs, vapid: { publicKey: 'p', privateKey: 'q', subject: 'mailto:x' }, send },
      },
    )
    expect(sendEmail).not.toHaveBeenCalled() // online + standard → no email
    expect(pushed.map((p) => p.endpoint)).toEqual(['https://push.test/a', 'https://push.test/b'])
    const payload = JSON.parse(pushed[0]!.payload)
    expect(payload.url).toBe('/inbox?conversation=conv-9')
    expect(payload.tag).toBe('conversation_assigned')
  })

  it('prunes an expired push subscription and never throws on push error', async () => {
    const { store } = makeStore()
    const expiredEndpoints: string[] = []
    const send = vi.fn(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('dead')) return { ok: false, status: 410, expired: true }
      throw new Error('push service 500')
    })
    await expect(
      dispatchNotification(
        {
          clinicId: 'c1',
          type: NOTIFICATION_TYPES.EMERGENCY,
          recipientEmail: 'a@b.com',
        },
        {
          store,
          sendEmail: vi.fn(async () => {}),
          push: {
            subscriptions: [
              { endpoint: 'https://push.test/dead', keys: { p256dh: 'x', auth: 'y' } },
              { endpoint: 'https://push.test/boom', keys: { p256dh: 'x', auth: 'y' } },
            ],
            vapid: { publicKey: 'p', privateKey: 'q', subject: 'mailto:x' },
            send,
            onExpired: (e) => {
              expiredEndpoints.push(e)
            },
          },
        },
      ),
    ).resolves.toBeUndefined()
    expect(expiredEndpoints).toEqual(['https://push.test/dead'])
  })

  it('every notification type has a defined, non-empty template', () => {
    for (const type of Object.values(NOTIFICATION_TYPES)) {
      const email = buildNotificationEmail(type, { sample: 1 })
      expect(email).toBeDefined()
      expect(email.subject.length).toBeGreaterThan(0)
      expect(email.html.length).toBeGreaterThan(0)
    }
  })

  it('meta_token_expiring email names the channel (Req 19)', () => {
    expect(buildNotificationEmail('meta_token_expiring', { channel: 'messenger' }).subject).toContain(
      'Messenger',
    )
    expect(buildNotificationEmail('meta_token_expiring', { channel: 'instagram' }).html).toContain(
      'Instagram',
    )
    // No channel → defaults to WhatsApp (back-compat with the existing producer).
    expect(buildNotificationEmail('meta_token_expiring', {}).subject).toContain('WhatsApp')
  })
})
