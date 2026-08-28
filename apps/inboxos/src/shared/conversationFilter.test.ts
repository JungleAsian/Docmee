import { describe, it, expect } from 'vitest'
import { conversationMatches, filterConversations, type ChannelFilter } from './conversationFilter'
import { projectConversationList, resolveActiveChannelFilter, shouldShowChannelFilter, visibleConversationLenses } from './components/ConversationList'
import type { Channel, Conversation } from './types'

function conv(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'cv-1',
    clinicId: 'c-1',
    patientId: null,
    channel: 'whatsapp',
    channelContactHandle: 'José Pérez',
    status: 'open',
    assignedTo: null,
    iaProfileId: null,
    lastMessageAt: '2026-06-20T10:00:00Z',
    metadata: {},
    createdAt: '2026-06-01',
    updatedAt: '2026-06-01',
    ...overrides,
  }
}

describe('conversationMatches', () => {
  it('matches everything with no query and no channel filter', () => {
    expect(conversationMatches(conv({}), '', 'all')).toBe(true)
    expect(conversationMatches(conv({}), '   ', 'all')).toBe(true)
  })

  it('matches the contact handle case-insensitively', () => {
    expect(conversationMatches(conv({ channelContactHandle: 'Ana López' }), 'ana', 'all')).toBe(true)
    expect(conversationMatches(conv({ channelContactHandle: 'Ana López' }), 'ANA', 'all')).toBe(true)
    expect(conversationMatches(conv({ channelContactHandle: 'Ana López' }), 'xyz', 'all')).toBe(false)
  })

  it('matches accented handles from a plain-ASCII query (LATAM names)', () => {
    expect(conversationMatches(conv({ channelContactHandle: 'José Pérez' }), 'jose', 'all')).toBe(true)
    expect(conversationMatches(conv({ channelContactHandle: 'María' }), 'maria', 'all')).toBe(true)
  })

  it('honours the channel filter', () => {
    const c = conv({ channel: 'instagram' })
    expect(conversationMatches(c, '', 'instagram')).toBe(true)
    expect(conversationMatches(c, '', 'whatsapp')).toBe(false)
  })

  it('requires BOTH channel and query to match when both are set', () => {
    const c = conv({ channel: 'messenger', channelContactHandle: 'Carlos' })
    expect(conversationMatches(c, 'carlos', 'messenger')).toBe(true)
    expect(conversationMatches(c, 'carlos', 'whatsapp')).toBe(false)
    expect(conversationMatches(c, 'diana', 'messenger')).toBe(false)
  })
})

describe('filterConversations', () => {
  const rows: Conversation[] = [
    conv({ id: 'a', channelContactHandle: 'José Pérez', channel: 'whatsapp' }),
    conv({ id: 'b', channelContactHandle: 'Ana López', channel: 'instagram' }),
    conv({ id: 'c', channelContactHandle: 'Carlos Ruiz', channel: 'messenger' }),
  ]

  it('returns the same array reference when no filter is active', () => {
    expect(filterConversations(rows, '', 'all')).toBe(rows)
  })

  it('filters by channel', () => {
    expect(filterConversations(rows, '', 'instagram').map((c) => c.id)).toEqual(['b'])
  })

  it('filters by search across the loaded set', () => {
    expect(filterConversations(rows, 'jose', 'all').map((c) => c.id)).toEqual(['a'])
  })

  it('returns empty when nothing matches', () => {
    const channel: ChannelFilter = 'whatsapp' as Channel
    expect(filterConversations(rows, 'zzz', channel)).toEqual([])
  })

  it('preserves input order for the matches', () => {
    // 'z' appears in Pérez, López and Ruiz — all three match, order unchanged.
    expect(filterConversations(rows, 'z', 'all').map((c) => c.id)).toEqual(['a', 'b', 'c'])
  })

  it('hides conversations from inactive or unconfigured channels when an active set is supplied', () => {
    expect(filterConversations(rows, '', 'all', new Set<Channel>(['whatsapp'])).map((c) => c.id)).toEqual(['a'])
    expect(filterConversations(rows, '', 'all', new Set<Channel>()).map((c) => c.id)).toEqual([])
  })

  it('does not hide conversations while the active-channel query is loading or failed', () => {
    expect(resolveActiveChannelFilter(false, { isLoading: true, isError: false })).toBeUndefined()
    expect(resolveActiveChannelFilter(false, { isLoading: false, isError: true })).toBeUndefined()
    expect(resolveActiveChannelFilter(false, { isLoading: false, isError: false })).toBeUndefined()
  })

  it('applies a successful empty active-channel projection and derives counts from the filtered rows', () => {
    const emptyFilter = resolveActiveChannelFilter(false, {
      isLoading: false,
      isError: false,
      data: { channels: [] },
    })
    expect(emptyFilter).toEqual(new Set())

    const activeFilter = resolveActiveChannelFilter(false, {
      isLoading: false,
      isError: false,
      data: { channels: [{ channel: 'whatsapp', name: 'Clinic WhatsApp' }] },
    })
    const projection = projectConversationList([
      conv({ id: 'bot', channel: 'whatsapp', status: 'open', assignedTo: null }),
      conv({ id: 'active', channel: 'instagram', status: 'pending' }),
      conv({ id: 'closed', channel: 'messenger', status: 'resolved' }),
    ], '', 'all', activeFilter)

    expect(projection.rows.map((conversation) => conversation.id)).toEqual(['bot'])
    expect(projection.counts).toEqual({ active: 0, bot: 1, assigned: 0, closed: 0 })
  })

  it('keeps the Closed lifecycle lens when inactive channels are hidden', () => {
    expect(visibleConversationLenses(false)).toEqual(['active', 'bot', 'assigned', 'closed'])
  })

  it('hides the channel selector when zero or one integration is active', () => {
    expect(shouldShowChannelFilter(new Set<Channel>())).toBe(false)
    expect(shouldShowChannelFilter(new Set<Channel>(['whatsapp']))).toBe(false)
    expect(shouldShowChannelFilter(new Set<Channel>(['whatsapp', 'instagram']))).toBe(true)
    expect(shouldShowChannelFilter(undefined)).toBe(true)
  })
})
