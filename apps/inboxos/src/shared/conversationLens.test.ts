import { describe, it, expect } from 'vitest'
import { isAssignedToUser, isClosed, matchesLens, lensCounts, LENSES } from './conversationLens'
import type { Conversation } from './types'

function conv(overrides: Partial<Conversation>): Conversation {
  return {
    id: 'cv-1',
    clinicId: 'c-1',
    patientId: null,
    channel: 'whatsapp',
    channelContactHandle: '+34123',
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

describe('isClosed', () => {
  it('is true only for resolved/archived', () => {
    expect(isClosed('resolved')).toBe(true)
    expect(isClosed('archived')).toBe(true)
    expect(isClosed('open')).toBe(false)
    expect(isClosed('pending')).toBe(false)
    expect(isClosed('assigned')).toBe(false)
  })
})

describe('matchesLens', () => {
  it('classifies a fresh open, unowned thread as bot and includes it in all', () => {
    const c = conv({ status: 'open', assignedTo: null })
    expect(matchesLens(c, 'bot')).toBe(true)
    expect(matchesLens(c, 'secretary')).toBe(false)
    expect(matchesLens(c, 'assigned')).toBe(false)
    expect(matchesLens(c, 'all')).toBe(true)
  })

  it('moves an open thread to secretary+assigned once a human owns it', () => {
    const c = conv({ status: 'open', assignedTo: 'u-1' })
    expect(matchesLens(c, 'bot')).toBe(false)
    expect(matchesLens(c, 'secretary')).toBe(true)
    expect(matchesLens(c, 'assigned')).toBe(true)
    expect(matchesLens(c, 'all')).toBe(true)
  })

  it('treats pending/handoff/snoozed as secretary, not bot', () => {
    for (const status of ['pending', 'handoff', 'snoozed'] as const) {
      const c = conv({ status })
      expect(matchesLens(c, 'secretary')).toBe(true)
      expect(matchesLens(c, 'bot')).toBe(false)
    }
  })

  it('an assigned-status thread is both secretary and assigned', () => {
    const c = conv({ status: 'assigned', assignedTo: 'u-2' })
    expect(matchesLens(c, 'secretary')).toBe(true)
    expect(matchesLens(c, 'assigned')).toBe(true)
    expect(matchesLens(c, 'all')).toBe(true)
  })

  it('keeps a closed thread in all but out of the operational lenses', () => {
    const c = conv({ status: 'resolved', assignedTo: 'u-3' })
    expect(matchesLens(c, 'all')).toBe(true)
    expect(matchesLens(c, 'assigned')).toBe(false)
    expect(matchesLens(c, 'secretary')).toBe(false)
    expect(matchesLens(c, 'bot')).toBe(false)
  })

  it('bot and secretary partition every live thread (exactly one matches)', () => {
    for (const status of ['open', 'pending', 'assigned', 'handoff', 'snoozed'] as const) {
      const c = conv({ status })
      const live = [matchesLens(c, 'bot'), matchesLens(c, 'secretary')].filter(Boolean)
      expect(live).toHaveLength(1)
    }
  })
})

describe('isAssignedToUser', () => {
  it('matches only live conversations owned by the current operator', () => {
    expect(isAssignedToUser(conv({ assignedTo: 'u-1' }), 'u-1')).toBe(true)
    expect(isAssignedToUser(conv({ assignedTo: 'u-2' }), 'u-1')).toBe(false)
    expect(isAssignedToUser(conv({ assignedTo: null }), 'u-1')).toBe(false)
    expect(isAssignedToUser(conv({ status: 'resolved', assignedTo: 'u-1' }), 'u-1')).toBe(false)
    expect(isAssignedToUser(conv({ assignedTo: 'u-1' }), null)).toBe(false)
  })
})

describe('lensCounts', () => {
  it('counts each lens independently across a mixed set', () => {
    const rows = [
      conv({ id: 'a', status: 'open', assignedTo: null }), // bot
      conv({ id: 'b', status: 'open', assignedTo: null }), // bot
      conv({ id: 'c', status: 'pending' }), // secretary
      conv({ id: 'd', status: 'assigned', assignedTo: 'u-1' }), // secretary + assigned
      conv({ id: 'e', status: 'resolved' }), // all only
      conv({ id: 'f', status: 'archived' }), // all only
    ]
    const counts = lensCounts(rows)
    expect(counts).toEqual({ all: 6, secretary: 2, bot: 2, assigned: 1 })
  })

  it('returns all-zero counts for an empty set', () => {
    const counts = lensCounts([])
    for (const lens of LENSES) expect(counts[lens]).toBe(0)
  })
})
