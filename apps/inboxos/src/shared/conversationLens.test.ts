import { describe, it, expect } from 'vitest'
import { isClosed, matchesLens, lensCounts, LENSES } from './conversationLens'
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
  it('classifies a fresh open, unowned thread as bot (and active excludes it)', () => {
    const c = conv({ status: 'open', assignedTo: null })
    expect(matchesLens(c, 'bot')).toBe(true)
    expect(matchesLens(c, 'active')).toBe(false)
    expect(matchesLens(c, 'assigned')).toBe(false)
    expect(matchesLens(c, 'closed')).toBe(false)
  })

  it('moves an open thread to active+assigned once a human owns it', () => {
    const c = conv({ status: 'open', assignedTo: 'u-1' })
    expect(matchesLens(c, 'bot')).toBe(false)
    expect(matchesLens(c, 'active')).toBe(true)
    expect(matchesLens(c, 'assigned')).toBe(true)
  })

  it('treats pending/handoff/snoozed as active, not bot', () => {
    for (const status of ['pending', 'handoff', 'snoozed'] as const) {
      const c = conv({ status })
      expect(matchesLens(c, 'active')).toBe(true)
      expect(matchesLens(c, 'bot')).toBe(false)
    }
  })

  it('an assigned-status thread is both active and assigned', () => {
    const c = conv({ status: 'assigned', assignedTo: 'u-2' })
    expect(matchesLens(c, 'active')).toBe(true)
    expect(matchesLens(c, 'assigned')).toBe(true)
    expect(matchesLens(c, 'closed')).toBe(false)
  })

  it('a closed thread is only closed — never assigned/active even if it still has an owner', () => {
    const c = conv({ status: 'resolved', assignedTo: 'u-3' })
    expect(matchesLens(c, 'closed')).toBe(true)
    expect(matchesLens(c, 'assigned')).toBe(false)
    expect(matchesLens(c, 'active')).toBe(false)
    expect(matchesLens(c, 'bot')).toBe(false)
  })

  it('bot and active partition every live thread (exactly one matches)', () => {
    for (const status of ['open', 'pending', 'assigned', 'handoff', 'snoozed'] as const) {
      const c = conv({ status })
      const live = [matchesLens(c, 'bot'), matchesLens(c, 'active')].filter(Boolean)
      expect(live).toHaveLength(1)
    }
  })
})

describe('lensCounts', () => {
  it('counts each lens independently across a mixed set', () => {
    const rows = [
      conv({ id: 'a', status: 'open', assignedTo: null }), // bot
      conv({ id: 'b', status: 'open', assignedTo: null }), // bot
      conv({ id: 'c', status: 'pending' }), // active
      conv({ id: 'd', status: 'assigned', assignedTo: 'u-1' }), // active + assigned
      conv({ id: 'e', status: 'resolved' }), // closed
      conv({ id: 'f', status: 'archived' }), // closed
    ]
    const counts = lensCounts(rows)
    expect(counts).toEqual({ active: 2, bot: 2, assigned: 1, closed: 2 })
  })

  it('returns all-zero counts for an empty set', () => {
    const counts = lensCounts([])
    for (const lens of LENSES) expect(counts[lens]).toBe(0)
  })
})
