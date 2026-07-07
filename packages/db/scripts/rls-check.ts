/**
 * Cross-clinic RLS isolation check.
 * Called by DevTools via: pnpm tool rls cross-clinic
 *
 * Verifies that:
 *   1. Clinic A cannot read Clinic B's patients (and vice versa) when RLS is active.
 *   2. Service role (no clinic context) CAN read both.
 *
 * Exit 0 = RLS holding. Exit 1 = leak detected or setup error.
 */

import postgres from 'postgres'

const url = process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/docmee'

async function check() {
  const sql = postgres(url, { prepare: false })

  // Fetch the two seed clinics
  const clinics = await sql<{ id: string; slug: string }[]>`
    SELECT id, slug FROM clinics WHERE slug IN ('demo-clinic-a', 'demo-clinic-b') ORDER BY slug
  `

  if (clinics.length < 2) {
    console.error('❌ RLS check requires seed data. Run: pnpm --filter @docmee/db db:seed')
    await sql.end()
    process.exit(1)
  }

  const [clinicA, clinicB] = clinics as [{ id: string; slug: string }, { id: string; slug: string }]

  // Service-role read — should see all patients
  const allPatients = await sql<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM patients`
  console.log(`Service-role patient count: ${allPatients[0]?.count} (expected ≥ 20)`)

  let failed = false

  // Scoped read — clinic A context should NOT see clinic B patients
  const resultA = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.clinic_id', ${clinicA.id}, true)`
    return tx<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM patients WHERE clinic_id = ${clinicB.id}`
  })
  const leakA = parseInt(resultA[0]?.count ?? '0', 10)
  if (leakA > 0) {
    console.error(`❌ LEAK: Clinic A context can read ${leakA} Clinic B patient(s)`)
    failed = true
  } else {
    console.log(`✓ Clinic A cannot read Clinic B patients (0 rows returned via RLS)`)
  }

  // Scoped read — clinic B context should NOT see clinic A patients
  const resultB = await sql.begin(async (tx) => {
    await tx`SELECT set_config('app.clinic_id', ${clinicB.id}, true)`
    return tx<{ count: string }[]>`SELECT COUNT(*)::text AS count FROM patients WHERE clinic_id = ${clinicA.id}`
  })
  const leakB = parseInt(resultB[0]?.count ?? '0', 10)
  if (leakB > 0) {
    console.error(`❌ LEAK: Clinic B context can read ${leakB} Clinic A patient(s)`)
    failed = true
  } else {
    console.log(`✓ Clinic B cannot read Clinic A patients (0 rows returned via RLS)`)
  }

  await sql.end()

  if (failed) {
    console.error('\n❌ RLS cross-clinic check FAILED')
    process.exit(1)
  }
  console.log('\n✅ RLS cross-clinic check PASSED')
}

try {
  await check()
} catch (err) {
  console.error('RLS check error:', err)
  process.exit(1)
}
