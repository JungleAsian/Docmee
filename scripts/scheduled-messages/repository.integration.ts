import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServiceDbClient, type Sql } from '../../packages/db/src/client.js'
import { createScheduledMessagesRepository, type CreateScheduledMessageInput } from '../../packages/db/src/repositories/scheduled-messages.repository.js'
import { isolatedDatabaseUrl } from './integration-target.mjs'

// Fail before opening a client unless the separate local fixture target is authorized.
const url = isolatedDatabaseUrl()
const sql = createServiceDbClient({ url })
const suffix = randomUUID().replaceAll('-', '')
const schema = `scheduled_fixture_${suffix}`
const role = `scheduled_reader_${suffix}`
let schemaCreated = false
let roleCreated = false
const clinic = randomUUID(), otherClinic = randomUUID()
const conversation = randomUUID(), otherConversation = randomUUID(), patient = randomUUID()

async function inSchema<T>(fn: (connection: Sql) => Promise<T>, restricted = false): Promise<T> {
  return await sql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path TO "${schema}"`)
    if (restricted) {
      await tx.unsafe(`SET LOCAL ROLE "${role}"`)
      await tx`SELECT set_config('app.clinic_id', ${clinic}, true)`
    }
    return fn(tx as unknown as Sql)
  }) as T
}
async function useRepository<T>(fn: (repository: ReturnType<typeof createScheduledMessagesRepository>) => Promise<T>, restricted = false) {
  return inSchema((connection) => fn(createScheduledMessagesRepository(connection)), restricted)
}
function input(overrides: Partial<CreateScheduledMessageInput> = {}): CreateScheduledMessageInput {
  return {
    clinicId: clinic, conversationId: conversation, patientId: patient,
    authorId: randomUUID(), accountId: randomUUID(), providerAccountId: 'synthetic-account',
    recipient: 'synthetic-not-a-phone', kind: 'text', content: 'Synthetic integration notice',
    scheduledAt: new Date(Date.now() - 1_000).toISOString(), timezone: 'UTC',
    idempotencyKey: randomUUID(), requestFingerprint: 'synthetic-fingerprint', ...overrides,
  }
}

beforeAll(async () => {
  // All identifiers are generated here, not derived from environment/user input.
  await sql.unsafe(`CREATE SCHEMA "${schema}"`)
  schemaCreated = true
  await inSchema(async (connection) => {
    // Minimal synthetic dependencies isolate this migration/repository, not the full migration chain.
    await connection.unsafe(`
      CREATE TABLE clinics (id uuid PRIMARY KEY);
      CREATE TABLE patients (id uuid PRIMARY KEY);
      CREATE TABLE message_templates (id uuid PRIMARY KEY);
      CREATE TABLE conversations (
        id uuid PRIMARY KEY, clinic_id uuid NOT NULL REFERENCES clinics(id), patient_id uuid NOT NULL REFERENCES patients(id),
        status text NOT NULL DEFAULT 'open', channel text DEFAULT 'whatsapp', channel_contact_handle text,
        metadata jsonb DEFAULT '{}', last_message_at timestamptz, updated_at timestamptz DEFAULT NOW()
      );
      CREATE TABLE conversation_messages (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conversation_id uuid NOT NULL REFERENCES conversations(id),
        clinic_id uuid NOT NULL REFERENCES clinics(id), role text NOT NULL, content text, content_type text,
        channel_message_id text, metadata jsonb DEFAULT '{}', created_at timestamptz DEFAULT NOW()
      );
      CREATE TABLE audit_events (
        clinic_id uuid, actor_id uuid, action text, resource_type text, resource_id uuid, metadata jsonb
      );
    `)
    await connection.unsafe(await readFile(new URL('../../packages/db/supabase/migrations/20261007000001_scheduled_messages.sql', import.meta.url), 'utf8'))
    await connection`INSERT INTO clinics (id) VALUES (${clinic}), (${otherClinic})`
    await connection`INSERT INTO patients (id) VALUES (${patient})`
    await connection`INSERT INTO conversations (id, clinic_id, patient_id) VALUES (${conversation}, ${clinic}, ${patient}), (${otherConversation}, ${otherClinic}, ${patient})`
  })
  // NOLOGIN, no superuser/BYPASSRLS; role used only inside test transactions.
  await sql.unsafe(`CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOBYPASSRLS`)
  roleCreated = true
  await sql.unsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`)
  await sql.unsafe(`GRANT SELECT, INSERT, UPDATE ON "${schema}".scheduled_messages TO "${role}"`)
})
afterAll(async () => {
  try {
    // Cleanup only this run's explicitly created schema/role; never drop/flush a database.
    if (schemaCreated) await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`)
    if (roleCreated) await sql.unsafe(`DROP ROLE "${role}"`)
  } finally { await sql.end({ timeout: 5 }) }
})

describe('scheduled migration and repository on isolated PostgreSQL', () => {
  it('returns one durable row for concurrent same-key creates', async () => {
    const data = input()
    const results = await Promise.all(Array.from({ length: 5 }, () => useRepository((repo) => repo.create(data))))
    expect(new Set(results.map((row) => row.id)).size).toBe(1)
    expect((await useRepository((repo) => repo.list(clinic, conversation))).filter((row) => row.id === results[0]!.id)).toHaveLength(1)
  })
  it('allows only one concurrent due claim', async () => {
    const row = await useRepository((repo) => repo.create(input()))
    const claims = await Promise.all(Array.from({ length: 5 }, () => useRepository((repo) => repo.claim(clinic, row.id, 1))))
    expect(claims.filter(Boolean)).toHaveLength(1)
  })
  it('gives one winner to competing claim, edit and cancellation', async () => {
    const row = await useRepository((repo) => repo.create(input()))
    const winners = await Promise.all([
      useRepository((repo) => repo.claim(clinic, row.id, 1)),
      useRepository((repo) => repo.cancel(clinic, conversation, row.id, 1)),
      useRepository((repo) => repo.edit(clinic, conversation, row.id, 1, input({ content: 'Synthetic edit' }))),
    ])
    expect(winners.filter(Boolean)).toHaveLength(1)
  })
  it('never claims future, cancelled, edited-version or cross-clinic rows', async () => {
    const future = await useRepository((repo) => repo.create(input({ scheduledAt: new Date(Date.now() + 60_000).toISOString() })))
    expect(await useRepository((repo) => repo.claim(clinic, future.id, 1))).toBeNull()
    const cancelled = await useRepository((repo) => repo.create(input()))
    await useRepository((repo) => repo.cancel(clinic, conversation, cancelled.id, 1))
    expect(await useRepository((repo) => repo.claim(clinic, cancelled.id, 1))).toBeNull()
    const edited = await useRepository((repo) => repo.create(input()))
    await useRepository((repo) => repo.edit(clinic, conversation, edited.id, 1, input()))
    expect(await useRepository((repo) => repo.claim(clinic, edited.id, 1))).toBeNull()
    expect(await useRepository((repo) => repo.claim(otherClinic, edited.id, 2))).toBeNull()
  })
  it('enforces RLS on reads and writes under a restricted role', async () => {
    const foreign = await useRepository((repo) => repo.create(input({ clinicId: otherClinic, conversationId: otherConversation })))
    expect(await useRepository((repo) => repo.find(otherClinic, otherConversation, foreign.id), true)).toBeNull()
    expect(await useRepository((repo) => repo.cancel(otherClinic, otherConversation, foreign.id, 1), true)).toBeNull()
    await expect(useRepository((repo) => repo.create(input({ clinicId: otherClinic, conversationId: otherConversation })), true)).rejects.toMatchObject({ code: '42501' })
    const allowed = await useRepository((repo) => repo.create(input()), true)
    expect(allowed.clinicId).toBe(clinic)
  })
  it('reconciles stale attempts to uncertainty and accepts one late confirmation without reopening a closed thread', async () => {
    const row = await useRepository((repo) => repo.create(input()))
    const claimed = (await useRepository((repo) => repo.claim(clinic, row.id, 1)))!
    await inSchema(async (connection) => {
      await connection`UPDATE scheduled_messages SET attempt_started_at = NOW() - INTERVAL '6 minutes' WHERE id = ${row.id}`
      await connection`UPDATE conversations SET status = 'closed', metadata = '{"syntheticPreserved":true}'::jsonb WHERE id = ${conversation}`
    })
    const due = await useRepository((repo) => repo.reconcile())
    expect(due.find((entry) => entry.id === row.id)).toBeUndefined()
    expect(await useRepository((repo) => repo.find(clinic, conversation, row.id))).toMatchObject({ status: 'delivery_unknown', reasonCode: 'stale_attempt' })
    await useRepository((repo) => repo.confirmed(claimed, 'synthetic-provider-id', 'Synthetic confirmed notice'))
    await useRepository((repo) => repo.confirmed(claimed, 'synthetic-provider-id', 'Synthetic confirmed notice'))
    await inSchema(async (connection) => {
      const timeline = await connection`SELECT id FROM conversation_messages WHERE metadata->>'scheduledMessageId' = ${row.id}`
      expect(timeline).toHaveLength(1)
      const threads = await connection`SELECT status, metadata, last_message_at FROM conversations WHERE id = ${conversation}`
      expect(threads[0]).toMatchObject({ status: 'closed', metadata: { syntheticPreserved: true } })
      expect(threads[0]!.lastMessageAt).toBeTruthy()
    })
  })
  it('rolls back sent state and timeline if audit persistence fails', async () => {
    const row = await useRepository((repo) => repo.create(input()))
    const claimed = (await useRepository((repo) => repo.claim(clinic, row.id, 1)))!
    await inSchema(async (connection) => {
      await connection.unsafe("ALTER TABLE audit_events ADD CONSTRAINT synthetic_reject_sent CHECK (action <> 'scheduled_message.sent') NOT VALID")
    })
    try {
      await expect(useRepository((repo) => repo.confirmed(claimed, 'synthetic-rejected-id', 'Synthetic rollback notice'))).rejects.toMatchObject({ code: '23514' })
      expect(await useRepository((repo) => repo.find(clinic, conversation, row.id))).toMatchObject({ status: 'sending' })
      await inSchema(async (connection) => {
        expect(await connection`SELECT id FROM conversation_messages WHERE metadata->>'scheduledMessageId' = ${row.id}`).toHaveLength(0)
      })
    } finally {
      await inSchema(async (connection) => { await connection.unsafe('ALTER TABLE audit_events DROP CONSTRAINT synthetic_reject_sent') })
    }
  })
  it('merges the current open-thread metadata and does not duplicate a confirmed send', async () => {
    const row = await useRepository((repo) => repo.create(input()))
    const claimed = (await useRepository((repo) => repo.claim(clinic, row.id, 1)))!
    await inSchema(async (connection) => {
      await connection`UPDATE conversations SET status = 'open', metadata = '{"syntheticCurrent":true}'::jsonb WHERE id = ${conversation}`
    })
    await useRepository((repo) => repo.confirmed(claimed, 'synthetic-open-id', 'Synthetic open notice'))
    await useRepository((repo) => repo.confirmed(claimed, 'synthetic-open-id', 'Synthetic open notice'))
    await inSchema(async (connection) => {
      const threads = await connection`SELECT status, metadata FROM conversations WHERE id = ${conversation}`
      expect(threads[0]).toMatchObject({ status: 'handoff', metadata: { syntheticCurrent: true, handoffReason: 'human_reply' } })
      expect(threads[0]!.metadata.botPausedAt).toBeTruthy()
      expect(await connection`SELECT id FROM conversation_messages WHERE metadata->>'scheduledMessageId' = ${row.id}`).toHaveLength(1)
      expect(await connection`SELECT resource_id FROM audit_events WHERE resource_id = ${row.id} AND action = 'scheduled_message.sent'`).toHaveLength(1)
    })
  })
  it('only uses inbound evidence from the same clinic, recipient and WhatsApp account', async () => {
    const scopedConversation = randomUUID()
    const inboundTime = new Date(Date.now() - 60_000).toISOString()
    await inSchema(async (connection) => {
      await connection`INSERT INTO conversations (id, clinic_id, patient_id, channel_contact_handle) VALUES (${scopedConversation}, ${clinic}, ${patient}, 'synthetic-recipient')`
      await connection`INSERT INTO conversation_messages (conversation_id, clinic_id, role, content, metadata, created_at)
        VALUES (${scopedConversation}, ${clinic}, 'user', 'Synthetic inbound', '{"phoneNumberId":"synthetic-scoped-account"}'::jsonb, ${inboundTime})`
    })
    expect(await useRepository((repo) => repo.lastInboundAt(clinic, patient, 'synthetic-recipient', 'synthetic-scoped-account'))).toBeTruthy()
    expect(await useRepository((repo) => repo.lastInboundAt(otherClinic, patient, 'synthetic-recipient', 'synthetic-scoped-account'))).toBeNull()
    expect(await useRepository((repo) => repo.lastInboundAt(clinic, patient, 'synthetic-other-recipient', 'synthetic-scoped-account'))).toBeNull()
    expect(await useRepository((repo) => repo.lastInboundAt(clinic, patient, 'synthetic-recipient', 'synthetic-other-account'))).toBeNull()
  })
})
