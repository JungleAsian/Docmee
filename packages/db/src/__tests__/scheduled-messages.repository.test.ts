import { describe, it, expect } from 'vitest'
import * as db from '../index.js'
import type { Sql } from '../client.js'

function captureSql() {
  const calls: { query: string; values: unknown[] }[] = []
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join('?'), values })
    return Promise.resolve([])
  }) as unknown as Sql
  sql.json = ((value: unknown) => value) as Sql['json']
  return { sql, calls }
}
describe('scheduled messages database boundary', () => {
  it('keeps every actionable row visible independently of bounded terminal history', async () => {
    const { sql, calls } = captureSql()
    await db.createScheduledMessagesRepository(sql).list('clinic', 'conversation')
    expect(calls[0]!.query).toContain("status IN ('pending', 'sending', 'delivery_unknown')")
    expect(calls[0]!.query).toContain('UNION ALL')
    expect(calls[0]!.query).toContain("status NOT IN ('pending', 'sending', 'delivery_unknown')")
  })
  it('claims only pending due rows at the expected version and records the attempt atomically', async () => {
    const { sql, calls } = captureSql()
    await db.createScheduledMessagesRepository(sql).claim('clinic', 'message', 3)
    expect(calls[0]?.query).toContain("status = 'pending'")
    expect(calls[0]?.query).toContain('version =')
    expect(calls[0]?.query).toContain('attempt_started_at = NOW()')
    expect(calls[0]?.query).toContain('scheduled_at <= NOW()')
    expect(calls[0]?.values).toEqual(['clinic', 'message', 3])
  })
  it('cancel is tenant/conversation/version scoped and cannot alter sending rows', async () => {
    const { sql, calls } = captureSql()
    await db.createScheduledMessagesRepository(sql).cancel('clinic', 'conversation', 'message', 4)
    expect(calls[0]?.query).toContain("status = 'pending'")
    expect(calls[0]?.query).toContain('conversation_id =')
    expect(calls[0]?.query).toContain('version = version + 1')
    expect(calls[0]?.values).toEqual(['clinic', 'conversation', 'message', 4])
  })
  it('care window lookup excludes other channels, accounts and recipients', async () => {
    const { sql, calls } = captureSql()
    await db.createScheduledMessagesRepository(sql).lastInboundAt('clinic', 'patient', 'recipient', 'account')
    expect(calls[0]?.query).toContain("c.channel = 'whatsapp'")
    expect(calls[0]?.query).toContain("m.metadata->>'phoneNumberId'")
    expect(calls[0]?.query).toContain("m.role = 'user'")
    expect(calls[0]?.values).toContain('recipient')
    expect(calls[0]?.values).toContain('account')
  })
  it('reconciles stale sending as unknown rather than pending', async () => {
    const { sql, calls } = captureSql()
    await db.createScheduledMessagesRepository(sql).reconcile()
    expect(calls[0]?.query).toContain("status = 'delivery_unknown'")
    expect(calls[0]?.query).toContain("status = 'sending'")
    expect(calls[0]?.query).not.toContain("SET status = 'pending'")
  })
  it('confirmed acceptance updates the timeline timestamp while merging current metadata and preserving closed status', async () => {
    const { sql, calls } = captureSql()
    await db.createScheduledMessagesRepository(sql).confirmed({ clinicId: 'clinic', id: 'message', version: 2, authorId: 'author', templateId: null } as db.ScheduledMessage, 'synthetic-provider-id', 'Synthetic')
    const query = calls[0]!.query
    expect(query).toContain('last_message_at = GREATEST')
    expect(query).toContain("CASE WHEN c.status = 'open' THEN 'handoff' ELSE c.status END")
    expect(query).toContain("COALESCE(c.metadata, '{}'::jsonb) ||")
    expect(query).toContain("ELSE c.metadata END")
    expect(query).toContain("reason_code = 'stale_attempt'")
    expect(query).toContain('provider_message_id =')
    expect(query).toContain('INSERT INTO conversation_messages')
  })
})
