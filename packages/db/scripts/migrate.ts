/**
 * Migration runner for @docmee/db.
 * Applies SQL files from supabase/migrations/ in lexicographic order.
 * Tracks applied migrations in the _migrations table.
 *
 * Usage:
 *   pnpm --filter @docmee/db db:migrate          # apply pending migrations
 *   pnpm --filter @docmee/db db:reset            # drop all tables then re-apply (destructive!)
 *
 * Requires: DATABASE_URL env var (e.g. postgres://postgres:postgres@localhost:5432/docmee)
 */

import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'supabase', 'migrations')

async function getApplied(sql: postgres.Sql): Promise<Set<string>> {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL      PRIMARY KEY,
      name       TEXT        UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `
  const rows = await sql<{ name: string }[]>`SELECT name FROM _migrations ORDER BY id`
  return new Set(rows.map((r) => r.name))
}

async function runMigrations(sql: postgres.Sql, reset: boolean) {
  if (reset) {
    console.log('⚠️  RESET MODE: dropping all tables...')
    await sql`DROP SCHEMA public CASCADE`
    await sql`CREATE SCHEMA public`
    console.log('Schema dropped and recreated.')
  }

  const applied = await getApplied(sql)
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort()
  const pending = files.filter((f) => !applied.has(f))

  if (pending.length === 0) {
    console.log('✅ No pending migrations.')
    return
  }

  for (const file of pending) {
    const path = join(MIGRATIONS_DIR, file)
    const sql_text = await readFile(path, 'utf8')
    console.log(`▶ Applying ${file}...`)
    try {
      await sql.unsafe(sql_text)
      await sql`INSERT INTO _migrations (name) VALUES (${file})`
      console.log(`  ✓ ${file}`)
    } catch (err) {
      console.error(`  ✗ ${file}: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    }
  }

  console.log(`✅ Applied ${pending.length} migration(s).`)
}

// Migrations run DDL — prefer DIRECT_URL (the Supabase SESSION pooler / direct
// connection) when set, since the app's DATABASE_URL may point at the TRANSACTION
// pooler (port 6543) which is meant for short app queries, not migrations.
const url = process.env['DIRECT_URL'] ?? process.env['DATABASE_URL'] ?? 'postgres://postgres:postgres@localhost:5432/docmee'
const reset = process.argv.includes('--reset')
const sql = postgres(url, { prepare: false })

try {
  await runMigrations(sql, reset)
} finally {
  await sql.end()
}
