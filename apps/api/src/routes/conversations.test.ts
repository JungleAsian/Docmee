import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

// buildApp wires every route; stub the workspace deps so no real Redis/DB/Google loads.
vi.mock('@docmee/queue', () => ({
  whatsappInboundQueue: { add: vi.fn() },
  kbEmbedQueue: { add: vi.fn() },
}))
vi.mock('@docmee/agents', () => ({ getOAuth2Client: () => ({}) }))
// Req 3 media proxy: stub the Graph media fetch so no real network call runs.
const { fetchMedia } = vi.hoisted(() => ({
  fetchMedia: vi.fn(async () => ({
    buffer: new TextEncoder().encode('JPEGBYTES').buffer,
    mimeType: 'image/jpeg',
  })),
}))
vi.mock('../lib/whatsapp-media.js', () => ({ fetchWhatsAppMedia: fetchMedia }))
// Req 3/33/34 outbound send: stub the inlined channel senders so no real Meta
// call runs. Each returns the provider message id the route persists.
const { sendWa, sendWaTpl, sendWaInt, sendWaList, sendMsgr, sendIg, uploadWaMedia, sendWaImage } = vi.hoisted(() => ({
  sendWa: vi.fn(async () => 'wamid.OUT1' as string | null),
  sendWaTpl: vi.fn(async () => 'wamid.TPL1' as string | null),
  sendWaInt: vi.fn(async () => 'wamid.INT1' as string | null),
  sendWaList: vi.fn(async () => 'wamid.LIST1' as string | null),
  sendMsgr: vi.fn(async () => 'mid.OUT1' as string | null),
  sendIg: vi.fn(async () => 'mid.IG1' as string | null),
  uploadWaMedia: vi.fn(async () => 'media-up-1'),
  sendWaImage: vi.fn(async () => 'wamid.IMG1' as string | null),
}))
vi.mock('../lib/channel-send.js', () => ({
  sendWhatsAppText: sendWa,
  sendWhatsAppTemplate: sendWaTpl,
  sendWhatsAppInteractive: sendWaInt,
  sendWhatsAppList: sendWaList,
  sendMessengerText: sendMsgr,
  sendInstagramText: sendIg,
  uploadWhatsAppMedia: uploadWaMedia,
  sendWhatsAppImage: sendWaImage,
}))
// Mutable clinic config so a test can flip a channel's connected state.
const clinicCfg = vi.hoisted(() => ({
  messengerEnabled: true,
  messengerPageAccessTokenEncrypted: 'mtok' as string | null,
  instagramEnabled: true,
  instagramPageAccessTokenEncrypted: 'itok' as string | null,
}))
vi.mock('@docmee/shared', () => ({
  encryptValue: (v: string) => `enc:${v}`,
  verifyPassword: () => true,
}))

const store = vi.hoisted(() => ({
  // A closed conversation reopen() should clone, an open one to assign, and two
  // already-assigned to different users (for the assigned_to filter test).
  conversations: new Map<string, Record<string, unknown>>([
    [
      'old-1',
      {
        id: 'old-1',
        clinicId: 'c-1',
        patientId: 'p-1',
        channel: 'whatsapp',
        channelContactHandle: '+50212345678',
        status: 'resolved',
        assignedTo: null,
        iaProfileId: 'ia-1',
      },
    ],
    [
      'open-1',
      {
        id: 'open-1',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50211112222',
        status: 'open',
        assignedTo: null,
        metadata: {},
      },
    ],
    [
      'mine-1',
      {
        id: 'mine-1',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50233334444',
        status: 'assigned',
        assignedTo: 'u-2',
        metadata: {},
      },
    ],
    [
      'theirs-1',
      {
        id: 'theirs-1',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50255556666',
        status: 'assigned',
        assignedTo: 'u-3',
        metadata: {},
      },
    ],
    // Dedicated open conversations for the outbound manual-reply send tests
    // (Req 3/33/34) — separate from open-1 so the assign tests can't mutate them.
    [
      'wa-send',
      {
        id: 'wa-send',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50277778888',
        status: 'open',
        assignedTo: null,
        metadata: {},
      },
    ],
    [
      'wa-fail',
      {
        id: 'wa-fail',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50299990000',
        status: 'open',
        assignedTo: null,
        metadata: {},
      },
    ],
    [
      'msgr-send',
      {
        id: 'msgr-send',
        clinicId: 'c-1',
        channel: 'messenger',
        channelContactHandle: 'PSID-123',
        status: 'open',
        assignedTo: null,
        metadata: {},
      },
    ],
    // Open WhatsApp thread reserved for the outbound image-attachment test (Req 3).
    [
      'wa-media',
      {
        id: 'wa-media',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50213131313',
        status: 'open',
        assignedTo: null,
        metadata: {},
      },
    ],
    // Open WhatsApp thread reserved for the HSM template-send test (Req 3) so the
    // manual-reply tests can't flip it to handoff first.
    [
      'wa-tpl',
      {
        id: 'wa-tpl',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50212121212',
        status: 'open',
        assignedTo: null,
        metadata: {},
      },
    ],
    // Open WhatsApp thread reserved for the interactive reply-button send test (Req 3).
    [
      'wa-int',
      {
        id: 'wa-int',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50214141414',
        status: 'open',
        assignedTo: null,
        metadata: {},
      },
    ],
    // Open WhatsApp thread reserved for the interactive LIST send test (Req 3).
    [
      'wa-list',
      {
        id: 'wa-list',
        clinicId: 'c-1',
        channel: 'whatsapp',
        channelContactHandle: '+50215151515',
        status: 'open',
        assignedTo: null,
        metadata: {},
      },
    ],
  ]),
  created: [] as Record<string, unknown>[],
  // Approved WhatsApp HSM templates a secretary can send by hand (Req 3). 'tpl-1'
  // is approved; 'tpl-pending' is not, so findApprovedById must skip it.
  templates: new Map<string, Record<string, unknown>>([
    ['tpl-1', { id: 'tpl-1', clinicId: 'c-1', name: 'appt_confirm', category: 'appointment_confirmation', language: 'es', body: 'Tu cita está confirmada.', status: 'approved' }],
    ['tpl-pending', { id: 'tpl-pending', clinicId: 'c-1', name: 'review', category: 'review_request', language: 'es', body: 'Déjanos tu opinión.', status: 'pending' }],
  ]),
  // Outbound messages persisted by POST /:id/messages (Req 3).
  sent: [] as Record<string, unknown>[],
  flagged: [] as Record<string, unknown>[],
  // Conversation messages (Req 3 media proxy). An image with a media id on open-1,
  // an image with no media id, and a text message — to exercise the proxy guards.
  messages: new Map<string, Record<string, unknown>>([
    ['msg-img', { id: 'msg-img', conversationId: 'open-1', clinicId: 'c-1', contentType: 'image', metadata: { mediaId: 'media-1' } }],
    ['msg-nomedia', { id: 'msg-nomedia', conversationId: 'open-1', clinicId: 'c-1', contentType: 'image', metadata: {} }],
    ['msg-text', { id: 'msg-text', conversationId: 'open-1', clinicId: 'c-1', contentType: 'text', metadata: {} }],
  ]),
  // Internal notes (Req 13). 'note-1' is authored by u-1; edit/delete is author-only.
  notes: new Map<string, Record<string, unknown>>([
    [
      'note-1',
      {
        id: 'note-1',
        conversationId: 'open-1',
        clinicId: 'c-1',
        authorId: 'u-1',
        content: 'Patient prefers mornings',
        createdAt: '2026-06-19T10:00:00.000Z',
        updatedAt: '2026-06-19T10:00:00.000Z',
      },
    ],
  ]),
}))

vi.mock('@docmee/db', () => ({
  createServiceDbClient: () => ({ end: async () => {} }),
  createConversationsRepository: () => ({
    listByClinic: async (clinicId: string) =>
      [...store.conversations.values()].filter((c) => c.clinicId === clinicId),
    // Req 20: tag names per conversation, attached to the list response.
    listTagNamesByClinic: async (clinicId: string) =>
      clinicId === 'c-1'
        ? [
            { conversationId: 'open-1', name: 'emergency' },
            { conversationId: 'open-1', name: 'appointment' },
            { conversationId: 'mine-1', name: 'urgent' },
          ]
        : [],
    // Req 4/35: last message per conversation, attached to the list response so each
    // row can show a preview line.
    listLastMessageByClinic: async (clinicId: string) =>
      [...store.messages.values()]
        .filter((m) => m.clinicId === clinicId)
        .map((m) => ({
          conversationId: m.conversationId as string,
          content: (m.content as string) ?? '',
          contentType: (m.contentType as string) ?? 'text',
          role: (m.role as string) ?? 'user',
        })),
    // Patient names per conversation, attached to the list response so each row can
    // show the patient's name instead of the raw handle. old-1 is linked to a named
    // patient; the others fall back to the channel handle (absent here → null).
    listPatientNamesByClinic: async (clinicId: string) =>
      clinicId === 'c-1' ? [{ conversationId: 'old-1', patientName: 'María Rodríguez' }] : [],
    findById: async (clinicId: string, id: string) => {
      const c = store.conversations.get(id)
      return c && c.clinicId === clinicId ? c : null
    },
    create: async (data: Record<string, unknown>) => {
      const row = { ...data, id: `new-${store.created.length + 1}`, status: 'open' }
      store.created.push(row)
      return row
    },
    update: async (clinicId: string, id: string, patch: Record<string, unknown>) => {
      const c = store.conversations.get(id)
      if (!c || c.clinicId !== clinicId) return null
      const updated = { ...c, ...patch }
      store.conversations.set(id, updated)
      return updated
    },
    listNotes: async (clinicId: string, conversationId: string) =>
      [...store.notes.values()].filter((n) => n.clinicId === clinicId && n.conversationId === conversationId),
    addNote: async (data: Record<string, unknown>) => {
      const row = {
        ...data,
        id: `note-${store.notes.size + 1}`,
        createdAt: '2026-06-19T11:00:00.000Z',
        updatedAt: '2026-06-19T11:00:00.000Z',
      }
      store.notes.set(row.id as string, row)
      return row
    },
    findNoteById: async (clinicId: string, noteId: string) => {
      const n = store.notes.get(noteId)
      return n && n.clinicId === clinicId ? n : null
    },
    updateNote: async (clinicId: string, noteId: string, content: string) => {
      const n = store.notes.get(noteId)
      if (!n || n.clinicId !== clinicId) return null
      const updated = { ...n, content, updatedAt: '2026-06-19T12:00:00.000Z' }
      store.notes.set(noteId, updated)
      return updated
    },
    deleteNote: async (_clinicId: string, noteId: string) => {
      store.notes.delete(noteId)
    },
  }),
  createMessagesRepository: () => ({
    findById: async (clinicId: string, id: string) => {
      const m = store.messages.get(id)
      return m && m.clinicId === clinicId ? m : null
    },
    create: async (data: Record<string, unknown>) => {
      const row = { ...data, id: `sent-${store.sent.length + 1}`, createdAt: '2026-06-19T13:00:00.000Z' }
      store.sent.push(row)
      return row
    },
  }),
  createChannelAccountsRepository: () => ({
    listByClinic: async (clinicId: string) =>
      clinicId === 'c-1'
        ? [{ channel: 'whatsapp', status: 'active', accountId: 'PHONE', accessTokenEnc: 'tok' }]
        : [],
  }),
  createClinicsRepository: () => ({
    findById: async (id: string) => (id === 'c-1' ? { id: 'c-1', ...clinicCfg } : null),
  }),
  createMessageTemplatesRepository: () => ({
    listApproved: async (clinicId: string) =>
      [...store.templates.values()].filter((tpl) => tpl.clinicId === clinicId && tpl.status === 'approved'),
    findApprovedById: async (clinicId: string, id: string) => {
      const tpl = store.templates.get(id)
      return tpl && tpl.clinicId === clinicId && tpl.status === 'approved' ? tpl : null
    },
  }),
  createPatientsRepository: () => ({
    // The detail endpoint enriches a conversation with its patient's name. p-1 is the
    // named patient linked to old-1.
    findById: async (clinicId: string, id: string) =>
      clinicId === 'c-1' && id === 'p-1' ? { id: 'p-1', clinicId, fullName: 'María Rodríguez' } : null,
  }),
  createKnowledgeRepository: () => ({}),
  createNotificationsRepository: () => ({}),
  createUsersRepository: () => ({
    listWithRoles: async (clinicId: string) =>
      clinicId === 'c-1'
        ? [
            { id: 'u-2', clinicId, email: 'sec@demo.test', fullName: 'Sec User', status: 'active', role: 'secretary' },
            { id: 'u-3', clinicId, email: 'doc@demo.test', fullName: 'Doc User', status: 'active', role: 'doctor' },
            { id: 'admin-1', clinicId, email: 'admin@demo.test', fullName: 'Admin User', status: 'active', role: 'clinic_admin' },
            { id: 'inactive-1', clinicId, email: 'old@demo.test', fullName: 'Inactive User', status: 'inactive', role: 'secretary' },
          ]
        : [],
  }),
  createErrorReviewsRepository: () => ({
    create: async (data: Record<string, unknown>) => {
      const row = { ...data, id: `err-${store.flagged.length + 1}`, status: 'open' }
      store.flagged.push(row)
      return row
    },
  }),
}))

import { buildApp } from '../app.js'
import { signAccessToken } from '../auth/jwt.js'

const tokenFor = (role: 'clinic_admin' | 'secretary' | 'doctor' | 'ia_studio_admin', userId = 'u-1') =>
  signAccessToken({ userId, clinicId: 'c-1', role, email: `${role}@demo.test` })
const authHeader = (role: Parameters<typeof tokenFor>[0], userId?: string) => ({
  authorization: `Bearer ${tokenFor(role, userId)}`,
})
const auth = authHeader('clinic_admin')

// Build a multipart/form-data body for the outbound image-send test (Req 3). The
// caption part is appended BEFORE the file so @fastify/multipart exposes it on
// file.fields when request.file() resolves the file part.
const BOUNDARY = '----docmeetestboundary'
function imagePayload({
  caption,
  filename = 'photo.jpg',
  contentType = 'image/jpeg',
  bytes = 'IMAGEBYTES',
}: {
  caption?: string
  filename?: string
  contentType?: string
  bytes?: string
} = {}) {
  const parts: string[] = []
  if (caption !== undefined) {
    parts.push(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`)
  }
  parts.push(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n${bytes}\r\n`,
  )
  parts.push(`--${BOUNDARY}--\r\n`)
  return Buffer.from(parts.join(''), 'utf8')
}
const multipartHeaders = (role: Parameters<typeof tokenFor>[0], userId?: string) => ({
  ...authHeader(role, userId),
  'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
})

describe('conversation routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    process.env['NODE_ENV'] = 'test'
    app = await buildApp()
    await app.ready()
  })
  afterAll(async () => {
    await app.close()
  })

  it('GET /conversations without auth → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations' })
    expect(res.statusCode).toBe(401)
  })

  it('GET /conversations with auth → 200 (all clinic conversations)', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.conversations.map((c: { id: string }) => c.id)).toEqual(
      expect.arrayContaining(['old-1', 'open-1', 'mine-1', 'theirs-1']),
    )
  })

  it('GET /conversations honours an admin\'s X-Clinic-Id header — Screen 6 clinic switching', async () => {
    // The seeded conversations all live in c-1, so switching the active clinic to
    // c-2 scopes the admin to that (empty) clinic instead of leaking c-1's threads.
    const res = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { ...authHeader('ia_studio_admin'), 'x-clinic-id': 'c-2' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).conversations).toEqual([])
  })

  it('GET /conversations rejects a non-admin\'s foreign X-Clinic-Id header → 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations',
      headers: { ...authHeader('secretary'), 'x-clinic-id': 'c-2' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('GET /conversations attaches each conversation\'s tag names (Req 20 — safety triage)', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    const open = body.conversations.find((c: { id: string }) => c.id === 'open-1')
    expect(open.tags).toEqual(expect.arrayContaining(['emergency', 'appointment']))
    const untagged = body.conversations.find((c: { id: string }) => c.id === 'theirs-1')
    expect(untagged.tags).toEqual([])
  })

  it('GET /conversations attaches each conversation\'s last message (Req 4 — list preview)', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    // open-1 has messages in the store → a lastMessage object is attached.
    const open = body.conversations.find((c: { id: string }) => c.id === 'open-1')
    expect(open.lastMessage).toMatchObject({ contentType: expect.any(String) })
    // theirs-1 has no messages → lastMessage is null.
    const noMessages = body.conversations.find((c: { id: string }) => c.id === 'theirs-1')
    expect(noMessages.lastMessage).toBeNull()
  })

  it('GET /conversations attaches the patient name per row (real name over raw handle)', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    // old-1 is linked to a named patient → patientName attached.
    const named = body.conversations.find((c: { id: string }) => c.id === 'old-1')
    expect(named.patientName).toBe('María Rodríguez')
    // open-1 has no patient → patientName null (the row falls back to the handle).
    const anon = body.conversations.find((c: { id: string }) => c.id === 'open-1')
    expect(anon.patientName).toBeNull()
  })

  it('GET /conversations/:id enriches the detail with the patient name', async () => {
    const res = await app.inject({ method: 'GET', url: '/conversations/old-1', headers: auth })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.conversation.patientName).toBe('María Rodríguez')
  })

  // ── Assigned conversation views (Rev1 #12) ──
  it('GET /conversations?assigned_to=… returns only that user\'s conversations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations?assigned_to=u-2',
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.conversations).toHaveLength(1)
    expect(body.conversations[0].id).toBe('mine-1')
  })

  it('GET /conversations?assigned_to=unassigned returns only unassigned conversations', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations?assigned_to=unassigned',
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    const ids = body.conversations.map((c: { id: string }) => c.id)
    // old-1/open-1 (and the unassigned send fixtures) have assignedTo null;
    // mine-1/theirs-1 are assigned and must be excluded.
    expect(ids).toEqual(expect.arrayContaining(['old-1', 'open-1']))
    expect(ids).not.toContain('mine-1')
    expect(ids).not.toContain('theirs-1')
  })

  // ── Assignment role permissions (Rev1 #12) ──
  // secretary, doctor and clinic_admin may assign; ia_studio_admin (platform
  // super-admin, not a clinic-inbox role) may not — mirroring /messages, /status
  // and /resume-bot.
  it.each(['secretary', 'doctor', 'clinic_admin'] as const)(
    'POST /conversations/:id/assign as %s → 200 and assigns',
    async (role) => {
      const res = await app.inject({
        method: 'POST',
        url: '/conversations/open-1/assign',
        headers: authHeader(role, `actor-${role}`),
        payload: { userId: 'u-2' },
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.conversation.assignedTo).toBe('u-2')
      expect(body.conversation.status).toBe('assigned')
    },
  )

  it('POST /conversations/:id/assign as secretary to clinic_admin ? 403', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/open-1/assign',
      headers: authHeader('secretary', 'actor-secretary'),
      payload: { userId: 'admin-1' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('POST /conversations/:id/assign as clinic_admin to clinic_admin ? 200', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/open-1/assign',
      headers: authHeader('clinic_admin', 'actor-admin'),
      payload: { userId: 'admin-1' },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).conversation.assignedTo).toBe('admin-1')
  })

  it('POST /conversations/:id/assign to inactive user ? 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/open-1/assign',
      headers: authHeader('clinic_admin', 'actor-admin'),
      payload: { userId: 'inactive-1' },
    })
    expect(res.statusCode).toBe(400)
  })
  it('POST /conversations/:id/assign allows an ia_studio_admin working in the active clinic', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/open-1/assign',
      headers: authHeader('ia_studio_admin'),
      payload: { userId: 'u-2' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('POST /conversations/:id/assign without auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/open-1/assign',
      payload: { userId: 'u-2' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('POST /conversations/:id/reopen creates a NEW conversation (Decision 4)', async () => {
    const res = await app.inject({ method: 'POST', url: '/conversations/old-1/reopen', headers: auth })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    // A fresh conversation, not the original being flipped back to open.
    expect(body.conversation.id).not.toBe('old-1')
    expect(body.conversation.channelContactHandle).toBe('+50212345678')
    expect(body.conversation.metadata).toEqual({ reopenedFrom: 'old-1' })
    expect(store.created).toHaveLength(1)
  })

  // ── Internal notes: author-only edit/delete (Rev1 #13) ──
  it('POST /conversations/:id/notes creates a note authored by the caller', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/open-1/notes',
      headers: authHeader('secretary', 'sec-1'),
      payload: { content: 'Call back tomorrow' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.note.authorId).toBe('sec-1')
    expect(body.note.content).toBe('Call back tomorrow')
  })

  it('PATCH /conversations/:id/notes/:noteId by the author → 200 and updates content', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/conversations/open-1/notes/note-1',
      headers: authHeader('clinic_admin', 'u-1'),
      payload: { content: 'Patient prefers afternoons' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.note.content).toBe('Patient prefers afternoons')
    expect(body.note.updatedAt).not.toBe(body.note.createdAt)
  })

  it('PATCH a note authored by someone else → 403 (author-only)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/conversations/open-1/notes/note-1',
      headers: authHeader('doctor', 'someone-else'),
      payload: { content: 'I should not be able to edit this' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('PATCH a non-existent note → 404', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/conversations/open-1/notes/does-not-exist',
      headers: authHeader('clinic_admin', 'u-1'),
      payload: { content: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE a note authored by someone else → 403, then the author → 200', async () => {
    const forbidden = await app.inject({
      method: 'DELETE',
      url: '/conversations/open-1/notes/note-1',
      headers: authHeader('secretary', 'not-the-author'),
    })
    expect(forbidden.statusCode).toBe(403)
    expect(store.notes.has('note-1')).toBe(true)

    const ok = await app.inject({
      method: 'DELETE',
      url: '/conversations/open-1/notes/note-1',
      headers: authHeader('clinic_admin', 'u-1'),
    })
    expect(ok.statusCode).toBe(200)
    expect(JSON.parse(ok.body).deleted).toBe(true)
    expect(store.notes.has('note-1')).toBe(false)
  })

  it('PATCH /conversations/:id/notes/:noteId without auth → 401', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/conversations/open-1/notes/note-1',
      payload: { content: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  // ── Flag a bad bot response → Error Review (Req 29) ──
  it('POST /conversations/:id/flag-response records a bad_response error review', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/open-1/flag-response',
      headers: authHeader('secretary', 'sec-9'),
      payload: { messageId: 'm-1', content: 'Tómese 2 ibuprofenos', note: 'gave dosage advice' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.error.errorType).toBe('bad_response')
    expect(body.error.errorMessage).toBe('Tómese 2 ibuprofenos')
    expect(body.error.context).toMatchObject({
      conversationId: 'open-1',
      messageId: 'm-1',
      flaggedBy: 'sec-9',
    })
  })

  it('POST /conversations/:id/flag-response for an unknown conversation → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/nope/flag-response',
      headers: authHeader('secretary', 'sec-9'),
      payload: { content: 'x' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /conversations/:id/flag-response without auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/open-1/flag-response',
      payload: { content: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  // ── Inbound media proxy (Req 3) ──
  it('GET /conversations/:id/messages/:messageId/media streams an image with the right mime type', async () => {
    fetchMedia.mockClear()
    const res = await app.inject({
      method: 'GET',
      url: '/conversations/open-1/messages/msg-img/media',
      headers: auth,
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.body).toBe('JPEGBYTES')
    // The Graph fetch is called with the stored media id and the clinic's WhatsApp token.
    expect(fetchMedia).toHaveBeenCalledWith('media-1', 'tok')
  })

  it('GET media without auth → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations/open-1/messages/msg-img/media',
    })
    expect(res.statusCode).toBe(401)
  })

  it('GET media for a non-image message → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations/open-1/messages/msg-text/media',
      headers: auth,
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET media for an image with no stored media id → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations/open-1/messages/msg-nomedia/media',
      headers: auth,
    })
    expect(res.statusCode).toBe(404)
  })

  it('GET media for an unknown message → 404', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations/open-1/messages/ghost/media',
      headers: auth,
    })
    expect(res.statusCode).toBe(404)
  })

  // ── Outbound manual reply DELIVERY (Req 3/33/34) ──
  // A secretary's reply must actually reach the patient over the conversation's
  // channel, persist the provider message id, and pause the bot.
  it('POST /conversations/:id/messages sends over WhatsApp, persists the wamid and pauses the bot', async () => {
    sendWa.mockClear()
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-send/messages',
      headers: authHeader('secretary'),
      payload: { content: 'Hola, ¿en qué puedo ayudarte?' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    // The send went out over WhatsApp with the clinic's phone id + token and the
    // patient's handle; the returned wamid is persisted as channel_message_id.
    expect(sendWa).toHaveBeenCalledWith('PHONE', 'tok', '+50277778888', 'Hola, ¿en qué puedo ayudarte?')
    expect(body.message.channelMessageId).toBe('wamid.OUT1')
    expect(body.message.role).toBe('agent')
    // Bot Interruption Rule: an `open` conversation flips to `handoff`.
    expect(store.conversations.get('wa-send')!.status).toBe('handoff')
  })

  it('POST /conversations/:id/messages on a Messenger thread sends via the Messenger transport', async () => {
    sendMsgr.mockClear()
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/msgr-send/messages',
      headers: authHeader('secretary'),
      payload: { content: 'Hello there' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(sendMsgr).toHaveBeenCalledWith('mtok', 'PSID-123', 'Hello there')
    expect(body.message.channelMessageId).toBe('mid.OUT1')
  })

  it('POST /conversations/:id/messages logs meta_send_failure and returns 502 when the send throws', async () => {
    sendWa.mockRejectedValueOnce(new Error('Meta 401: token expired'))
    const before = store.flagged.length
    const sentBefore = store.sent.length
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-fail/messages',
      headers: authHeader('secretary'),
      payload: { content: 'will not send' },
    })
    expect(res.statusCode).toBe(502)
    // A failed send is recorded for the Error Review area and nothing is persisted.
    expect(store.flagged.length).toBe(before + 1)
    expect(store.flagged.at(-1)!.errorType).toBe('meta_send_failure')
    expect(store.sent.length).toBe(sentBefore)
    // The bot is NOT paused on a failed send (the conversation stays `open`).
    expect(store.conversations.get('wa-fail')!.status).toBe('open')
  })

  it('POST /conversations/:id/messages → 502 when the channel is not connected', async () => {
    clinicCfg.messengerEnabled = false
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/conversations/msgr-send/messages',
        headers: authHeader('secretary'),
        payload: { content: 'no channel' },
      })
      expect(res.statusCode).toBe(502)
    } finally {
      clinicCfg.messengerEnabled = true
    }
  })

  it('POST /conversations/:id/messages for an unknown conversation → 404', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/ghost/messages',
      headers: authHeader('secretary'),
      payload: { content: 'hi' },
    })
    expect(res.statusCode).toBe(404)
  })

  // ── Approved HSM template send from the inbox (Req 3) ──
  it('GET /conversations/:id/templates lists only approved templates for a WhatsApp thread', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations/wa-tpl/templates',
      headers: authHeader('secretary'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.templates.map((tpl: { id: string }) => tpl.id)).toEqual(['tpl-1'])
  })

  it('GET /conversations/:id/templates is empty for a non-WhatsApp thread', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/conversations/msgr-send/templates',
      headers: authHeader('secretary'),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).templates).toEqual([])
  })

  it('POST /conversations/:id/send-template sends the approved template, persists the wamid and pauses the bot', async () => {
    sendWaTpl.mockClear()
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-tpl/send-template',
      headers: authHeader('secretary'),
      payload: { templateId: 'tpl-1' },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    // The template went out by name + language on the clinic's WhatsApp number; the
    // bubble carries the template body and the returned wamid.
    expect(sendWaTpl).toHaveBeenCalledWith('PHONE', 'tok', '+50212121212', 'appt_confirm', 'es')
    expect(body.message.channelMessageId).toBe('wamid.TPL1')
    expect(body.message.content).toBe('Tu cita está confirmada.')
    expect(body.message.contentType).toBe('template')
    expect(store.conversations.get('wa-tpl')!.status).toBe('handoff')
  })

  it('POST /conversations/:id/send-template → 404 for a pending (unapproved) template', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-send/send-template',
      headers: authHeader('secretary'),
      payload: { templateId: 'tpl-pending' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('POST /conversations/:id/send-template → 400 on a non-WhatsApp thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/msgr-send/send-template',
      headers: authHeader('secretary'),
      payload: { templateId: 'tpl-1' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /conversations/:id/send-template logs meta_send_failure and returns 502 when the send throws', async () => {
    sendWaTpl.mockRejectedValueOnce(new Error('Meta 132001: template not found'))
    const before = store.flagged.length
    const sentBefore = store.sent.length
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-fail/send-template',
      headers: authHeader('secretary'),
      payload: { templateId: 'tpl-1' },
    })
    expect(res.statusCode).toBe(502)
    expect(store.flagged.length).toBe(before + 1)
    expect(store.flagged.at(-1)!.errorType).toBe('meta_send_failure')
    expect(store.sent.length).toBe(sentBefore)
    expect(store.conversations.get('wa-fail')!.status).toBe('open')
  })

  // ── Outbound interactive reply-button menu (Req 3) ──
  it('POST /conversations/:id/send-interactive sends the menu, persists the wamid + buttons and pauses the bot', async () => {
    sendWaInt.mockClear()
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-int/send-interactive',
      headers: authHeader('secretary'),
      payload: { body: '¿Confirmas tu cita?', buttons: ['Sí, confirmar', 'Reprogramar'] },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    // The menu went out on the clinic's WhatsApp number with the body + buttons.
    expect(sendWaInt).toHaveBeenCalledWith('PHONE', 'tok', '+50214141414', '¿Confirmas tu cita?', [
      'Sí, confirmar',
      'Reprogramar',
    ])
    expect(body.message.channelMessageId).toBe('wamid.INT1')
    expect(body.message.contentType).toBe('interactive')
    expect(body.message.content).toBe('¿Confirmas tu cita?')
    expect(body.message.metadata).toMatchObject({ buttons: ['Sí, confirmar', 'Reprogramar'] })
    // Bot Interruption Rule: an `open` conversation flips to `handoff`.
    expect(store.conversations.get('wa-int')!.status).toBe('handoff')
  })

  it('POST /conversations/:id/send-interactive → 400 with no buttons', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-send/send-interactive',
      headers: authHeader('secretary'),
      payload: { body: 'pick one', buttons: [] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /conversations/:id/send-interactive → 400 on a non-WhatsApp thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/msgr-send/send-interactive',
      headers: authHeader('secretary'),
      payload: { body: 'pick one', buttons: ['A'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /conversations/:id/send-interactive logs meta_send_failure and returns 502 when the send throws', async () => {
    sendWaInt.mockRejectedValueOnce(new Error('Meta 401: token expired'))
    const before = store.flagged.length
    const sentBefore = store.sent.length
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-fail/send-interactive',
      headers: authHeader('secretary'),
      payload: { body: 'will not send', buttons: ['A', 'B'] },
    })
    expect(res.statusCode).toBe(502)
    expect(store.flagged.length).toBe(before + 1)
    expect(store.flagged.at(-1)!.errorType).toBe('meta_send_failure')
    expect(store.sent.length).toBe(sentBefore)
    expect(store.conversations.get('wa-fail')!.status).toBe('open')
  })

  // ── Outbound interactive LIST menu (Req 3) — the >3-options surface ──
  it('POST /conversations/:id/send-list sends the menu, persists the wamid + sections and pauses the bot', async () => {
    sendWaList.mockClear()
    const sections = [
      {
        title: 'Mañana',
        rows: [
          { title: '09:00', description: 'Dr. Pérez' },
          { title: '10:30', description: 'Dra. Gómez' },
        ],
      },
    ]
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-list/send-list',
      headers: authHeader('secretary'),
      payload: { body: 'Elige un horario', button: 'Ver horarios', sections },
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    // The list went out on the clinic's WhatsApp number with the body, button label
    // and sections.
    expect(sendWaList).toHaveBeenCalledWith(
      'PHONE',
      'tok',
      '+50215151515',
      'Elige un horario',
      'Ver horarios',
      sections,
    )
    expect(body.message.channelMessageId).toBe('wamid.LIST1')
    expect(body.message.contentType).toBe('interactive')
    expect(body.message.content).toBe('Elige un horario')
    expect(body.message.metadata).toMatchObject({ listButton: 'Ver horarios', sections })
    // Bot Interruption Rule: an `open` conversation flips to `handoff`.
    expect(store.conversations.get('wa-list')!.status).toBe('handoff')
  })

  it('POST /conversations/:id/send-list → 400 with no rows', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-send/send-list',
      headers: authHeader('secretary'),
      payload: { body: 'pick one', button: 'Menu', sections: [{ rows: [] }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /conversations/:id/send-list → 400 when more than 10 rows in total', async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => ({ title: `Row ${i}` }))
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-send/send-list',
      headers: authHeader('secretary'),
      payload: { body: 'pick one', button: 'Menu', sections: [{ rows: tooMany }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /conversations/:id/send-list → 400 on a non-WhatsApp thread', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/msgr-send/send-list',
      headers: authHeader('secretary'),
      payload: { body: 'pick one', button: 'Menu', sections: [{ rows: [{ title: 'A' }] }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /conversations/:id/send-list logs meta_send_failure and returns 502 when the send throws', async () => {
    sendWaList.mockRejectedValueOnce(new Error('Meta 401: token expired'))
    const before = store.flagged.length
    const sentBefore = store.sent.length
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-fail/send-list',
      headers: authHeader('secretary'),
      payload: { body: 'will not send', button: 'Menu', sections: [{ rows: [{ title: 'A' }] }] },
    })
    expect(res.statusCode).toBe(502)
    expect(store.flagged.length).toBe(before + 1)
    expect(store.flagged.at(-1)!.errorType).toBe('meta_send_failure')
    expect(store.sent.length).toBe(sentBefore)
    expect(store.conversations.get('wa-fail')!.status).toBe('open')
  })

  // ── Outbound image attachment (Req 3) — two-step WhatsApp media upload ──
  it('POST /conversations/:id/send-media uploads the image, sends it, persists the wamid + media id and pauses the bot', async () => {
    uploadWaMedia.mockClear()
    sendWaImage.mockClear()
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-media/send-media',
      headers: multipartHeaders('secretary'),
      payload: imagePayload({ caption: 'Aquí tienes la receta' }),
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    // Step 1: the bytes are uploaded to the clinic's WhatsApp number with its token.
    expect(uploadWaMedia).toHaveBeenCalledWith('PHONE', 'tok', expect.anything(), 'image/jpeg', 'photo.jpg')
    // Step 2: the image message references the returned media id and carries the caption.
    expect(sendWaImage).toHaveBeenCalledWith('PHONE', 'tok', '+50213131313', 'media-up-1', 'Aquí tienes la receta')
    // The bubble is an image with the wamid + the uploaded media id (so the inbox
    // media proxy can render the sent image inline) and the caption as content.
    expect(body.message.channelMessageId).toBe('wamid.IMG1')
    expect(body.message.contentType).toBe('image')
    expect(body.message.content).toBe('Aquí tienes la receta')
    expect(body.message.metadata).toMatchObject({ mediaId: 'media-up-1', mimeType: 'image/jpeg' })
    // Bot Interruption Rule: an `open` conversation flips to `handoff`.
    expect(store.conversations.get('wa-media')!.status).toBe('handoff')
  })

  it('POST /conversations/:id/send-media rejects a non-image file → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-fail/send-media',
      headers: multipartHeaders('secretary'),
      payload: imagePayload({ filename: 'notes.pdf', contentType: 'application/pdf' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /conversations/:id/send-media on a non-WhatsApp thread → 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/msgr-send/send-media',
      headers: multipartHeaders('secretary'),
      payload: imagePayload(),
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /conversations/:id/send-media logs meta_send_failure and returns 502 when the send throws', async () => {
    sendWaImage.mockRejectedValueOnce(new Error('Meta 401: token expired'))
    const before = store.flagged.length
    const sentBefore = store.sent.length
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-fail/send-media',
      headers: multipartHeaders('secretary'),
      payload: imagePayload(),
    })
    expect(res.statusCode).toBe(502)
    expect(store.flagged.length).toBe(before + 1)
    expect(store.flagged.at(-1)!.errorType).toBe('meta_send_failure')
    expect(store.sent.length).toBe(sentBefore)
    expect(store.conversations.get('wa-fail')!.status).toBe('open')
  })

  it('POST /conversations/:id/send-media without auth → 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/conversations/wa-media/send-media',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: imagePayload(),
    })
    expect(res.statusCode).toBe(401)
  })
})
