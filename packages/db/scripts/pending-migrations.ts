/**
 * READ-ONLY pre-deploy migration report. Never applies, creates or alters anything.
 *
 *   tsx scripts/pending-migrations.ts [--ref <git-sha>] [--no-db]
 *
 * --ref    Compare the migrations that exist at that git revision (the code about
 *          to be deployed) with what the database has recorded. Without it, the
 *          working tree is used.
 * --no-db  Skip the database; list the revision's migrations and screen their SQL.
 *
 * Connects with DIRECT_URL, else DATABASE_URL, in a read-only session
 * (default_transaction_read_only=on), so even a bug here cannot write. Prints
 * migration file names and statement snippets only — never connection details,
 * rows, or environment variables.
 *
 * Exit codes: 0 = nothing blocking, 2 = needs a human decision (destructive
 * pending migration, or the database is ahead of the target revision), 1 = error.
 */

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'
import { classifyMigrationSql, hasDestructive, planMigrations, type MigrationRisk } from '../src/migration-plan.js'

const here = dirname(fileURLToPath(import.meta.url))
// DOCMEE_REPO_ROOT lets predeploy-check.sh run the target revision's copy of this
// script from a temp folder while still reading git history and the live checkout.
const repoRoot = process.env['DOCMEE_REPO_ROOT'] ?? join(here, '..', '..', '..')
const MIGRATIONS_REL = 'packages/db/supabase/migrations'

const args = process.argv.slice(2)
const refIndex = args.indexOf('--ref')
const ref = refIndex >= 0 ? args[refIndex + 1] : undefined
const skipDb = args.includes('--no-db')

if (refIndex >= 0 && (!ref || !/^[0-9a-fA-F]{7,40}$/.test(ref))) {
  console.error('--ref requires a git commit SHA (7-40 hex characters).')
  process.exit(1)
}

function git(...gitArgs: string[]): string {
  return execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}

function targetFiles(): string[] {
  if (ref) {
    return git('ls-tree', '--name-only', ref, `${MIGRATIONS_REL}/`)
      .split('\n')
      .map((line) => line.trim().split('/').pop() ?? '')
      .filter((name) => name.endsWith('.sql'))
  }
  return readdirSync(join(repoRoot, MIGRATIONS_REL)).filter((name) => name.endsWith('.sql'))
}

function targetSql(file: string): string {
  return ref ? git('show', `${ref}:${MIGRATIONS_REL}/${file}`) : readFileSync(join(repoRoot, MIGRATIONS_REL, file), 'utf8')
}

async function appliedMigrations(): Promise<{ names: string[]; trackingTableMissing: boolean }> {
  const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL']
  if (!url) throw new Error('No DIRECT_URL or DATABASE_URL in the environment.')
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    connection: { default_transaction_read_only: true },
  })
  try {
    // Explicit READ ONLY transaction: the database itself rejects any write, so
    // the guarantee does not depend on the connection parameter above alone.
    const rows = await sql.begin('read only', async (tx) => tx<{ name: string }[]>`SELECT name FROM _migrations`)
    return { names: rows.map((row) => row.name), trackingTableMissing: false }
  } catch (error) {
    if ((error as { code?: string }).code === '42P01') return { names: [], trackingTableMissing: true }
    throw error
  } finally {
    await sql.end({ timeout: 5 })
  }
}

// One line per (file, rule), with a count — routine idempotent DDL such as
// `DROP POLICY IF EXISTS` would otherwise bury the findings that matter.
function printRisks(file: string, risks: readonly MigrationRisk[]): void {
  const groups = new Map<string, { risk: MigrationRisk; count: number }>()
  for (const risk of risks) {
    const key = `${risk.severity}|${risk.rule}`
    const group = groups.get(key)
    if (group) group.count += 1
    else groups.set(key, { risk, count: 1 })
  }
  for (const { risk, count } of groups.values()) {
    const times = count > 1 ? ` (x${count})` : ''
    console.log(`  ${risk.severity.toUpperCase()} ${file}: ${risk.rule}${times} — e.g. ${risk.statement}`)
  }
}

async function main(): Promise<number> {
  const files = targetFiles()
  console.log(`Target revision: ${ref ?? 'working tree'} (${files.length} migration file(s))`)

  let blocking = false

  if (skipDb) {
    console.log('Database check skipped (--no-db). Screening all migrations in the revision:')
    for (const file of files.sort()) {
      const risks = classifyMigrationSql(targetSql(file))
      if (risks.length > 0) printRisks(file, risks)
    }
    return 0
  }

  const { names, trackingTableMissing } = await appliedMigrations()
  if (trackingTableMissing) console.log('WARN: _migrations table not found; treating every migration as pending.')
  const plan = planMigrations(files, names)
  console.log(`Database has applied ${plan.alreadyApplied} of the target revision's migrations.`)

  if (plan.unknownToTarget.length > 0) {
    blocking = true
    console.log(`BLOCKING: the database has ${plan.unknownToTarget.length} migration(s) the target revision does not contain.`)
    console.log('  Deploying it would run older code against a newer schema:')
    for (const name of plan.unknownToTarget) console.log(`  - ${name}`)
  }

  if (plan.pending.length === 0) {
    console.log('No pending migrations: the schema already matches the target revision.')
  } else {
    console.log(`${plan.pending.length} pending migration(s) would be applied, in this order:`)
    for (const file of plan.pending) {
      const risks = classifyMigrationSql(targetSql(file))
      const verdict = hasDestructive(risks) ? 'DESTRUCTIVE — review before applying' : risks.length > 0 ? 'caution' : 'additive'
      console.log(`  - ${file}  [${verdict}]`)
      if (hasDestructive(risks)) blocking = true
      printRisks(file, risks)
    }
    console.log('Apply these BEFORE deploying the code, after taking an RDS snapshot.')
  }

  return blocking ? 2 : 0
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // Connection errors can embed hostnames; report only a code or error name.
    const code = (error as { code?: string }).code ?? (error instanceof Error ? error.name : 'unknown')
    const known = error instanceof Error && error.message.startsWith('No DIRECT_URL') ? ` ${error.message}` : ''
    console.error(`pending-migrations failed (${code}).${known}`)
    process.exit(1)
  },
)
