import Fastify from 'fastify'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import route from './scheduled-messages.js'
import { signAccessToken } from '../auth/jwt.js'
const state = vi.hoisted(() => ({ enabled: false, reason: null as string | null, record: { id: 'scheduled', kind: 'text', content: 'Synthetic', templateId: null, scheduledAt: '2026-10-08T12:00:00Z', timezone: 'UTC', status: 'pending', version: 1, reasonCode: null, createdAt: '2026-10-07T12:00:00Z', clinicId: 'clinic', conversationId: 'conversation', authorId: 'author', patientId: 'patient', accountId: 'account', providerAccountId: 'provider-account', recipient: 'synthetic-recipient', idempotencyKey: 'synthetic-key' }, conflict: false }))
const boundary = vi.hoisted(() => ({ add: vi.fn(), create: vi.fn(), edit: vi.fn(), cancel: vi.fn(), audit: vi.fn(), findByKey: vi.fn() }))
vi.mock('@docmee/queue', () => ({ scheduledMessagesQueue: { add: boundary.add } }))
vi.mock('../lib/db.js', () => ({ withDb: async (fn: (sql: object) => unknown) => fn({}) }))
vi.mock('../lib/scheduled-message-context.js', () => ({ loadScheduledContext: async () => ({ reason: state.reason, clinic: { timezone: 'UTC', settings: { scheduledMessages: { enabled: state.enabled } } }, conversation: { id: 'conversation', patientId: 'patient', channelContactHandle: 'synthetic-recipient' }, account: { id: 'account', accountId: 'provider-account' }, content: 'Synthetic' }) }))
vi.mock('@docmee/db', () => ({
  createConversationsRepository: () => ({ findById: async (clinic: string) => clinic === 'clinic' ? { id: 'conversation' } : null }),
  createClinicsRepository: () => ({ findById: async () => ({ timezone: 'UTC', settings: { scheduledMessages: { enabled: state.enabled } } }) }),
  createAuditRepository: () => ({ log: boundary.audit }),
  createScheduledMessagesRepository: () => ({ list: async () => [state.record], find: async () => state.record, findByIdempotencyKey: boundary.findByKey, create: boundary.create, edit: boundary.edit, cancel: boundary.cancel }),
}))
async function inject(method: 'GET' | 'POST' | 'PATCH', path = '', body?: object, clinicId = 'clinic') {
  const app = Fastify()
  await app.register(route)
  const result = await app.inject({ method, url: `/conversations/conversation/scheduled-messages${path}`, headers: { authorization: `Bearer ${signAccessToken({ userId: 'author', accountUserId: 'account-user', clinicId, role: 'secretary', email: 'synthetic@example.invalid' })}` }, ...(body ? { payload: body } : {}) })
  await app.close()
  return result
}
const input = { kind: 'text', content: 'Synthetic', scheduledAt: '2099-10-08T12:00:00Z', timezone: 'UTC', idempotencyKey: 'synthetic-key' }
describe('scheduled messages API contract', () => {
  beforeEach(() => { vi.clearAllMocks(); boundary.findByKey.mockResolvedValue(null); state.enabled = false; state.reason = null; state.conflict = false; boundary.create.mockImplementation(async (input) => ({ ...state.record, requestFingerprint: input.requestFingerprint })); boundary.edit.mockResolvedValue(state.record); boundary.cancel.mockResolvedValue({ ...state.record, status: 'cancelled', version: 2 }) })
  it('returns an existing immutable request after due time or disablement, but rejects key reuse for different content', async () => {
    state.enabled = true
    await inject('POST', '', input)
    const createdInput = boundary.create.mock.calls[0]![0]
    boundary.findByKey.mockResolvedValue({ ...state.record, requestFingerprint: createdInput.requestFingerprint, status: 'sent' })
    state.enabled = false
    const replay = await inject('POST', '', input)
    expect(replay.statusCode).toBe(200)
    expect(replay.json().message.status).toBe('sent')
    expect(boundary.findByKey).toHaveBeenCalledWith('clinic', 'conversation', 'author', 'synthetic-key')
    expect((await inject('POST', '', { ...input, content: 'Different synthetic' })).statusCode).toBe(409)
    expect(boundary.create).toHaveBeenCalledTimes(1)
  })
  it('lists disabled state and history without exposing recipient/account/author fields', async () => {
    const response = await inject('GET')
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ enabled: false, timezone: 'UTC', messages: [{ id: 'scheduled', kind: 'text', content: 'Synthetic', templateId: null, scheduledAt: '2026-10-08T12:00:00Z', timezone: 'UTC', status: 'pending', version: 1, reasonCode: null, createdAt: '2026-10-07T12:00:00Z' }] })
  })
  it('rejects create while disabled and validates future time/timezone', async () => {
    expect((await inject('POST', '', input)).statusCode).toBe(403)
    state.enabled = true
    expect((await inject('POST', '', { ...input, timezone: 'Invalid/Zone' })).statusCode).toBe(400)
    expect((await inject('POST', '', { ...input, scheduledAt: '2020-01-01T00:00:00Z' })).statusCode).toBe(400)
    expect(boundary.create).not.toHaveBeenCalled()
  })
  it('creates durable state with a versioned colon-free queue wakeup and never sends', async () => {
    state.enabled = true
    const response = await inject('POST', '', input)
    expect(response.statusCode).toBe(201)
    expect(response.json().message.version).toBe(1)
    expect(boundary.create).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'clinic', authorId: 'author', recipient: 'synthetic-recipient', accountId: 'account' }))
    expect(boundary.add).toHaveBeenCalledWith('deliver', { clinicId: 'clinic', messageId: 'scheduled', version: 1 }, expect.objectContaining({ jobId: 'scheduled-scheduled-v1', attempts: 1, removeOnFail: true }))
  })
  it('preserves durable creation when queue is unavailable for the DB reconciler', async () => {
    state.enabled = true; boundary.add.mockRejectedValueOnce(new Error('synthetic queue unavailable'))
    expect((await inject('POST', '', input)).statusCode).toBe(201)
  })
  it('blocks unsafe templates and cross-tenant access', async () => {
    state.enabled = true; state.reason = 'template_unsafe'
    const rejected = await inject('POST', '', { ...input, content: undefined, kind: 'template', templateId: 'template' })
    expect(rejected.statusCode).toBe(400)
    expect(rejected.json().reasonCode).toBe('template_unsafe')
    expect((await inject('GET', '', undefined, 'foreign')).statusCode).toBe(404)
  })
  it('returns 409 when edit/cancel loses a version/claim race, and cancels despite clinic disabled', async () => {
    state.enabled = true; boundary.edit.mockResolvedValueOnce(null)
    expect((await inject('PATCH', '/scheduled', { ...input, idempotencyKey: undefined, version: 1 })).statusCode).toBe(409)
    state.enabled = false; boundary.cancel.mockResolvedValueOnce(null)
    expect((await inject('POST', '/scheduled/cancel', { version: 1 })).statusCode).toBe(409)
    expect((await inject('POST', '/scheduled/cancel', { version: 1 })).statusCode).toBe(200)
  })
})
