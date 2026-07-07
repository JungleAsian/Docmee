// P17 — Cross-clinic isolation integration test (Gap #40).
//
// The Vitest equivalent of `pnpm tool rls cross-clinic`:
//   1. Create two test clinics
//   2. Insert a conversation under each
//   3. Verify clinic A cannot read clinic B's data
//
// Isolation is checked at two layers:
//   - Repository scoping (deterministic): every repo method is clinic-scoped, so
//     findById(clinicA, convoB) must return null.
//   - Row-Level Security (defense in depth): within withClinicContext(clinicA) the
//     conversations table must not expose clinic B's row. This part is skipped when
//     RLS is not enforceable for the connecting role (e.g. a superuser DSN).
//
// Skipped entirely when the test DB is unreachable so the headless gate stays green.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { dbAvailable, serviceDb, DATABASE_URL } from './_infra.js'
import { createDbClient, withClinicContext, createConversationsRepository, type Sql } from '@docmee/db'

const hasDb = await dbAvailable()

describe.skipIf(!hasDb)('RLS cross-clinic isolation', () => {
  let svc: Sql
  let scoped: Sql
  let clinicA = ''
  let clinicB = ''
  let convoA = ''
  let convoB = ''
  let rlsEnforceable = false

  beforeAll(async () => {
    svc = serviceDb()
    scoped = createDbClient({ url: DATABASE_URL })

    await svc`DELETE FROM clinics WHERE slug IN ('int-rls-a', 'int-rls-b')`
    const [a] = await svc<{ id: string }[]>`
      INSERT INTO clinics (name, slug, plan, status)
      VALUES ('RLS Clinic A', 'int-rls-a', 'pro', 'active') RETURNING id
    `
    const [b] = await svc<{ id: string }[]>`
      INSERT INTO clinics (name, slug, plan, status)
      VALUES ('RLS Clinic B', 'int-rls-b', 'pro', 'active') RETURNING id
    `
    clinicA = a!.id
    clinicB = b!.id

    const repo = createConversationsRepository(svc)
    convoA = (await repo.create({ clinicId: clinicA, channel: 'whatsapp', channelContactHandle: 'rls-a-handle' })).id
    convoB = (await repo.create({ clinicId: clinicB, channel: 'whatsapp', channelContactHandle: 'rls-b-handle' })).id

    // RLS only constrains a non-superuser / non-BYPASSRLS role with the policy on.
    const [{ enforceable }] = await svc<{ enforceable: boolean }[]>`
      SELECT (c.relrowsecurity AND NOT r.rolsuper AND NOT r.rolbypassrls) AS enforceable
      FROM pg_class c
      JOIN pg_roles r ON r.rolname = current_user
      WHERE c.relname = 'conversations'
    `
    rlsEnforceable = enforceable ?? false
  })

  afterAll(async () => {
    if (clinicA || clinicB) await svc`DELETE FROM clinics WHERE slug IN ('int-rls-a', 'int-rls-b')`
    await svc?.end()
    await scoped?.end()
  })

  it('repository scoping blocks cross-clinic reads', async () => {
    const repo = createConversationsRepository(svc)
    // Clinic A sees its own conversation…
    expect(await repo.findById(clinicA, convoA)).not.toBeNull()
    // …but not clinic B's, even though the row exists.
    expect(await repo.findById(clinicA, convoB)).toBeNull()
  })

  it('RLS hides clinic B rows inside clinic A context', async () => {
    if (!rlsEnforceable) {
      // Honest skip: the connecting role bypasses RLS, so this layer cannot be proven here.
      console.warn('[rls.integration] RLS not enforceable for current_user — skipping policy-level assertion')
      return
    }
    const visibleToA = await withClinicContext(scoped, clinicA, async (tx) => {
      const rows = await tx<{ id: string }[]>`SELECT id FROM conversations WHERE id IN (${convoA}, ${convoB})`
      return rows.map((r) => r.id)
    })
    expect(visibleToA).toContain(convoA)
    expect(visibleToA).not.toContain(convoB)
  })
})
