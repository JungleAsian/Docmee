/**
 * Local seed script — inserts fake development data.
 * NEVER run against production. All data is synthetic; no real PHI.
 *
 * Creates:
 *   - 2 demo clinics
 *   - 3 demo users (clinic_users)
 *   - 10 fake patients per clinic (20 total)
 *   - 1 IA profile per clinic
 *   - Basic services and providers
 *
 * Usage: pnpm --filter @docmee/db db:seed
 */

import postgres from 'postgres'
import { randomBytes, scryptSync } from 'node:crypto'

// Seeding does heavy inserts — prefer DIRECT_URL (session pooler / direct) when set,
// matching the migration script (the app's DATABASE_URL may be the transaction pooler).
const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/docmee'
const sql = postgres(url, { prepare: false, transform: postgres.camel })

// Mirrors @docmee/shared hashPassword (`scrypt$salt$key`); inlined so the seed
// script keeps its single `postgres` dependency.
function hashPassword(plaintext: string): string {
  const salt = randomBytes(16)
  return `scrypt$${salt.toString('hex')}$${scryptSync(plaintext, salt, 64).toString('hex')}`
}

const DEMO_PASSWORD = 'demo1234'

// ── Fake data helpers ──────────────────────────────────────────────────────────

const CLINIC_A_SLUG = 'demo-clinic-a'
const CLINIC_B_SLUG = 'demo-clinic-b'

const fakePatients = (clinicId: string) =>
  Array.from({ length: 10 }, (_, i) => ({
    clinic_id: clinicId,
    full_name: `Paciente Demo ${i + 1}`,
    status: i < 8 ? 'returning' : 'new',
    notes: null,
    metadata: '{}',
  }))

const fakeContacts = (clinicId: string, patientId: string, idx: number, suffix: string) => ({
  patient_id: patientId,
  clinic_id: clinicId,
  channel: 'whatsapp',
  // Fake phone numbers — non-real, safe for dev
  contact_handle: `+5020000${suffix}${String(idx + 1).padStart(2, '0')}`,
  is_primary: true,
})

// ── Main ───────────────────────────────────────────────────────────────────────

async function seed() {
  const existing = await sql<{ name: string }[]>`
    SELECT name FROM dev_seed_runs WHERE name IN (${CLINIC_A_SLUG}, ${CLINIC_B_SLUG})
  `
  if (existing.length > 0) {
    console.log('⚠️  Seed already ran. Use db:reset first to reseed.')
    return
  }

  await sql.begin(async (tx) => {
    // ── Clinics ──
    const [clinicA] = await tx<{ id: string }[]>`
      INSERT INTO clinics (name, slug, plan, timezone)
      VALUES ('Clínica Demo A', ${CLINIC_A_SLUG}, 'pro', 'America/Guatemala')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `
    const [clinicB] = await tx<{ id: string }[]>`
      INSERT INTO clinics (name, slug, plan, timezone)
      VALUES ('Clínica Demo B', ${CLINIC_B_SLUG}, 'starter', 'America/Guatemala')
      ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `

    const clinicAId = clinicA!.id
    const clinicBId = clinicB!.id
    console.log(`✓ Clinics: ${clinicAId}, ${clinicBId}`)

    // ── Users ──
    const users = [
      { clinic_id: clinicAId, user_id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'admin@demo-a.test', full_name: 'Admin Demo A', status: 'active' },
      { clinic_id: clinicAId, user_id: 'aaaaaaaa-0000-0000-0000-000000000002', email: 'secretary@demo-a.test', full_name: 'Secretaria Demo A', status: 'active' },
      { clinic_id: clinicAId, user_id: 'aaaaaaaa-0000-0000-0000-0000000000aa', email: 'studio@demo.test', full_name: 'Admin Studio Admin', status: 'active' },
      { clinic_id: clinicBId, user_id: 'bbbbbbbb-0000-0000-0000-000000000001', email: 'admin@demo-b.test', full_name: 'Admin Demo B', status: 'active' },
    ]
    for (const u of users) {
      await tx`
        INSERT INTO clinic_users (clinic_id, user_id, email, full_name, status)
        VALUES (${u.clinic_id}, ${u.user_id}::uuid, ${u.email}, ${u.full_name}, ${u.status})
        ON CONFLICT (clinic_id, user_id) DO NOTHING
      `
    }
    console.log(`✓ Users: ${users.length}`)

    // ── Roles, passwords, role assignments (P08 auth — enables panel login) ──
    const demoPasswordHash = hashPassword(DEMO_PASSWORD)
    const assignments = [
      { email: 'admin@demo-a.test', clinicId: clinicAId, role: 'clinic_admin' },
      { email: 'secretary@demo-a.test', clinicId: clinicAId, role: 'secretary' },
      { email: 'studio@demo.test', clinicId: clinicAId, role: 'ia_studio_admin' },
      { email: 'admin@demo-b.test', clinicId: clinicBId, role: 'clinic_admin' },
    ]
    for (const a of assignments) {
      const [u] = await tx<{ id: string; userId: string }[]>`
        UPDATE clinic_users SET password_hash = ${demoPasswordHash}
        WHERE clinic_id = ${a.clinicId} AND email = ${a.email}
        RETURNING id, user_id
      `
      // Login authorization resolves from memberships. Use the system role catalogue
      // so seeded accounts exercise the same access model as production accounts.
      const [role] = await tx<{ id: string }[]>`
        SELECT id FROM roles
        WHERE clinic_id IS NULL AND name = ${a.role} AND is_system = TRUE
        LIMIT 1
      `
      await tx`
        INSERT INTO user_roles (clinic_user_id, role_id)
        VALUES (${u!.id}, ${role!.id})
        ON CONFLICT DO NOTHING
      `
      await tx`
        INSERT INTO memberships (user_id, clinic_id, role_id, status)
        VALUES (
          ${u!.userId},
          ${a.role === 'ia_studio_admin' ? null : a.clinicId},
          ${role!.id},
          'active'
        )
        ON CONFLICT DO NOTHING
      `
    }
    console.log(`✓ Roles + passwords: demo login ready (password: ${DEMO_PASSWORD})`)

    // ── Patients ──
    for (const [clinicId, suffix] of [[clinicAId, '0'] as const, [clinicBId, '1'] as const]) {
      const rows = fakePatients(clinicId)
      for (let i = 0; i < rows.length; i++) {
        const p = rows[i]!
        const [patient] = await tx<{ id: string }[]>`
          INSERT INTO patients (clinic_id, full_name, status)
          VALUES (${p.clinic_id}, ${p.full_name}, ${p.status})
          RETURNING id
        `
        const contact = fakeContacts(clinicId, patient!.id, i, suffix)
        await tx`
          INSERT INTO patient_contacts (patient_id, clinic_id, channel, contact_handle, is_primary)
          VALUES (${contact.patient_id}, ${contact.clinic_id}, ${contact.channel}, ${contact.contact_handle}, ${contact.is_primary})
          ON CONFLICT DO NOTHING
        `
      }
    }
    console.log('✓ Patients: 20 (10 per clinic)')

    // ── IA profiles ──
    await tx`
      INSERT INTO ia_profiles (clinic_id, name, system_prompt, model)
      VALUES (${clinicAId}, 'Asistente Demo A', 'Eres un asistente médico amigable para Clínica Demo A.', 'claude-sonnet-4-6')
    `
    await tx`
      INSERT INTO ia_profiles (clinic_id, name, system_prompt, model)
      VALUES (${clinicBId}, 'Asistente Demo B', 'Eres un asistente médico amigable para Clínica Demo B.', 'claude-sonnet-4-6')
    `
    console.log('✓ IA profiles: 2')

    // ── Providers ──
    for (const clinicId of [clinicAId, clinicBId]) {
      await tx`
        INSERT INTO providers (clinic_id, full_name, specialty)
        VALUES (${clinicId}, 'Dr. Demo', 'Medicina General')
      `
    }
    console.log('✓ Providers: 2')

    // ── Services ──
    for (const clinicId of [clinicAId, clinicBId]) {
      await tx`
        INSERT INTO services (clinic_id, name, duration_minutes, currency)
        VALUES (${clinicId}, 'Consulta General', 30, 'GTQ')
      `
    }
    console.log('✓ Services: 2')

    // ── Feature flags (global defaults) ──
    const flags = ['whatsapp_enabled', 'messenger_enabled', 'instagram_enabled', 'ai_enabled', 'appointments_enabled']
    for (const name of flags) {
      await tx`
        INSERT INTO feature_flags (name, enabled, rollout_percentage)
        VALUES (${name}, ${name === 'whatsapp_enabled' || name === 'ai_enabled'}, 100)
        ON CONFLICT (name, clinic_id) DO NOTHING
      `
    }
    console.log('✓ Feature flags: default set')

    // ── Record seed run ──
    await tx`INSERT INTO dev_seed_runs (name, status) VALUES (${CLINIC_A_SLUG}, 'success')`
    await tx`INSERT INTO dev_seed_runs (name, status) VALUES (${CLINIC_B_SLUG}, 'success')`
  })

  console.log('\n✅ Seed complete.')
}

try {
  await seed()
} catch (err) {
  console.error('Seed failed:', err)
  process.exit(1)
} finally {
  await sql.end()
}
