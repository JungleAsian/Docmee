import { describe, it, expect } from 'vitest'
import { createQosRepository } from '../repositories/qos.repository.js'
import type { Sql } from '../client.js'

// A tagged-template stand-in for postgres.js: each QoS query carries a leading
// `-- qos:<name>` marker comment, so we can route it to canned rows and assert the
// dashboard's post-processing (rounding, attention-reason derivation) without a DB.
// `now` lets us make attention rows deterministically "aged" vs "recent".
function fakeSql(now: number): Sql {
  const recent = new Date(now - 60 * 1000).toISOString() // 1 min ago — not stale
  const old = new Date(now - 48 * 60 * 60 * 1000).toISOString() // 48h ago — stale at 24h
  const fn = ((strings: TemplateStringsArray) => {
    const q = strings.join(' ')
    if (q.includes('qos:upset')) return Promise.resolve([{ total: '5', unresolved: '2' }])
    if (q.includes('qos:response'))
      return Promise.resolve([{ botSeconds: '12.4', secretarySeconds: '125.6' }])
    if (q.includes('qos:closure')) return Promise.resolve([{ unclosed: '9', unclosedAged: '4' }])
    if (q.includes('qos:abandoned')) return Promise.resolve([{ count: '3' }])
    if (q.includes('qos:followup')) return Promise.resolve([{ count: '7' }])
    if (q.includes('qos:pending')) return Promise.resolve([{ count: '6' }])
    if (q.includes('qos:attention'))
      return Promise.resolve([
        // upset wins regardless of recency; unowned ⇒ bot mode
        {
          conversationId: 'a',
          patientName: 'Ana',
          status: 'open',
          channel: 'whatsapp',
          assignedTo: null,
          lastMessageAt: recent,
          upset: true,
          lastRole: 'user',
        },
        // aged + clinic spoke last → abandoned; owned ⇒ human mode
        {
          conversationId: 'b',
          patientName: 'Beto',
          status: 'handoff',
          channel: 'messenger',
          assignedTo: 'agent-1',
          lastMessageAt: old,
          upset: false,
          lastRole: 'assistant',
        },
        // aged + patient spoke last → unclosed
        {
          conversationId: 'c',
          patientName: null,
          status: 'open',
          channel: 'instagram',
          assignedTo: null,
          lastMessageAt: old,
          upset: false,
          lastRole: 'user',
        },
        // recent + not upset → no reason, dropped from the list
        {
          conversationId: 'd',
          patientName: 'Dani',
          status: 'pending',
          channel: 'whatsapp',
          assignedTo: null,
          lastMessageAt: recent,
          upset: false,
          lastRole: 'assistant',
        },
      ])
    return Promise.resolve([])
  }) as unknown as Sql
  return fn
}

describe('qos.repository — dashboard (Req 32 QoS monitoring)', () => {
  it('computes the QoS figures and rounds response times', async () => {
    const qos = await createQosRepository(fakeSql(Date.now())).dashboard('clinic-1')

    expect(qos.upsetPatients).toBe(5)
    expect(qos.upsetUnresolved).toBe(2)
    expect(qos.abandonedConversations).toBe(3)
    expect(qos.avgBotResponseSeconds).toBe(12) // rounded from 12.4
    expect(qos.avgSecretaryResponseSeconds).toBe(126) // rounded from 125.6
    expect(qos.unclosedConversations).toBe(9)
    expect(qos.unclosedAged).toBe(4)
    expect(qos.followUpOpportunities).toBe(7)
    expect(qos.pendingFollowUps).toBe(6)
    expect(qos.staleHours).toBe(24) // default
  })

  it('derives an attention reason per conversation and drops healthy ones', async () => {
    const qos = await createQosRepository(fakeSql(Date.now())).dashboard('clinic-1')

    expect(qos.attention.map((a) => [a.conversationId, a.reason])).toEqual([
      ['a', 'upset'],
      ['b', 'abandoned'],
      ['c', 'unclosed'],
    ])
    // Mode derives from ownership: owned ⇒ human, unowned ⇒ bot.
    expect(qos.attention.map((a) => [a.conversationId, a.mode])).toEqual([
      ['a', 'bot'],
      ['b', 'human'],
      ['c', 'bot'],
    ])
    // Null patient name normalizes to empty string.
    expect(qos.attention[2]!.patientName).toBe('')
  })

  it('honors a custom stale-hours threshold', async () => {
    const qos = await createQosRepository(fakeSql(Date.now())).dashboard('clinic-1', 72)
    expect(qos.staleHours).toBe(72)
    // At 72h the 48h-old rows are no longer stale, so only the upset one survives.
    expect(qos.attention.map((a) => a.conversationId)).toEqual(['a'])
  })

  it('returns zeros with no activity (no divide-by-zero, empty attention)', async () => {
    const empty = (() => Promise.resolve([])) as unknown as Sql
    const qos = await createQosRepository(empty).dashboard('clinic-1')

    expect(qos.upsetPatients).toBe(0)
    expect(qos.abandonedConversations).toBe(0)
    expect(qos.avgBotResponseSeconds).toBe(0)
    expect(qos.avgSecretaryResponseSeconds).toBe(0)
    expect(qos.unclosedConversations).toBe(0)
    expect(qos.followUpOpportunities).toBe(0)
    expect(qos.pendingFollowUps).toBe(0)
    expect(qos.attention).toEqual([])
  })
})
