import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const repo = vi.hoisted(() => ({
  rows: [] as Array<{ endpoint: string; p256dh: string; auth: string }>,
  pruned: [] as string[],
}))

vi.mock('@docmee/db', () => ({
  createPushSubscriptionsRepository: () => ({
    listByRecipient: async () => repo.rows,
    pruneEndpoint: async (endpoint: string) => {
      repo.pruned.push(endpoint)
      return true
    },
  }),
}))

import { buildPushDispatch, readVapidKeys } from '../push-dispatch.js'

const fakeSql = {} as never

describe('readVapidKeys', () => {
  beforeEach(() => {
    delete process.env['VAPID_PUBLIC_KEY']
    delete process.env['VAPID_PRIVATE_KEY']
    delete process.env['VAPID_SUBJECT']
  })

  it('returns null when keys are not configured', () => {
    expect(readVapidKeys()).toBeNull()
  })

  it('reads the keypair and defaults the subject', () => {
    process.env['VAPID_PUBLIC_KEY'] = 'pub'
    process.env['VAPID_PRIVATE_KEY'] = 'priv'
    expect(readVapidKeys()).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:ops@docmee.app' })
  })
})

describe('buildPushDispatch', () => {
  beforeEach(() => {
    repo.rows = []
    repo.pruned = []
    process.env['VAPID_PUBLIC_KEY'] = 'pub'
    process.env['VAPID_PRIVATE_KEY'] = 'priv'
    delete process.env['VAPID_SUBJECT']
  })
  afterEach(() => {
    delete process.env['VAPID_PUBLIC_KEY']
    delete process.env['VAPID_PRIVATE_KEY']
  })

  it('returns undefined when VAPID is not configured', async () => {
    delete process.env['VAPID_PUBLIC_KEY']
    repo.rows = [{ endpoint: 'https://p/1', p256dh: 'x', auth: 'y' }]
    expect(await buildPushDispatch(fakeSql, 'c-1', 'a@b.com')).toBeUndefined()
  })

  it('returns undefined when the recipient has no devices', async () => {
    repo.rows = []
    expect(await buildPushDispatch(fakeSql, 'c-1', 'a@b.com')).toBeUndefined()
  })

  it('maps device rows to subscriptions and wires expiry pruning', async () => {
    repo.rows = [
      { endpoint: 'https://p/1', p256dh: 'k1', auth: 'a1' },
      { endpoint: 'https://p/2', p256dh: 'k2', auth: 'a2' },
    ]
    const push = await buildPushDispatch(fakeSql, 'c-1', 'a@b.com')
    expect(push).toBeDefined()
    expect(push!.vapid).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:ops@docmee.app' })
    expect(push!.subscriptions).toEqual([
      { endpoint: 'https://p/1', keys: { p256dh: 'k1', auth: 'a1' } },
      { endpoint: 'https://p/2', keys: { p256dh: 'k2', auth: 'a2' } },
    ])
    await push!.onExpired!('https://p/1')
    expect(repo.pruned).toEqual(['https://p/1'])
  })
})
