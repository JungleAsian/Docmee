#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const envPath = path.join(root, '.env')
const examplePath = path.join(root, '.env.example')
const required = [
  'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET',
  'ENCRYPTION_KEY', 'PUBLIC_API_URL', 'DOCMEE_BUILD_ID',
]
const placeholders = new Set(['', 'replace-with-local-anon-key', 'replace-with-local-service-role-key'])

function parseEnv(file) {
  if (!existsSync(file)) return new Map()
  return new Map(readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return []
    const split = trimmed.indexOf('=')
    return split < 1 ? [] : [[trimmed.slice(0, split), trimmed.slice(split + 1)]]
  }))
}

function value(name, env) {
  return process.env[name] ?? env.get(name) ?? ''
}

async function portOpen(host, port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port })
    socket.setTimeout(750)
    socket.once('connect', () => { socket.destroy(); resolve(true) })
    socket.once('error', () => resolve(false))
    socket.once('timeout', () => { socket.destroy(); resolve(false) })
  })
}

function report(ok, label, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`)
  return ok
}

const env = parseEnv(envPath)
let failures = 0
console.log(`Docmee preflight: ${root}`)
if (process.argv.includes('--template')) {
  const template = parseEnv(examplePath)
  if (!existsSync(examplePath)) {
    report(false, '.env.example', 'missing')
    process.exitCode = 1
  } else {
    for (const name of required) {
      const present = template.has(name) && template.get(name)?.trim().length > 0
      if (!report(Boolean(present), `template:${name}`, present ? '' : 'missing or empty')) failures += 1
    }
    if (!failures) console.log('Environment template covers every preflight-required configuration key.')
    else console.error(`Environment-template validation failed with ${failures} problem(s).`)
    process.exitCode = failures ? 1 : 0
  }
} else {
if (!existsSync(envPath)) {
  failures += 1
  report(false, '.env', 'missing; copy .env.example and set local values')
} else report(true, '.env')
report(existsSync(examplePath), '.env.example', existsSync(examplePath) ? '' : 'missing') || (failures += 1)

for (const name of required) {
  const current = value(name, env).trim()
  const ok = current.length > 0 && !placeholders.has(current) && !current.startsWith('replace-with-')
  if (!report(ok, `env:${name}`, ok ? '' : 'set a non-placeholder local value')) failures += 1
}
const access = value('JWT_SECRET', env)
const refresh = value('JWT_REFRESH_SECRET', env)
if (!report(Boolean(access && refresh && access !== refresh), 'JWT secrets distinct', 'JWT_SECRET and JWT_REFRESH_SECRET must differ')) failures += 1

const docker = spawnSync(process.platform === 'win32' ? 'docker.exe' : 'docker', ['compose', 'version'], { cwd: root, encoding: 'utf8' })
if (!report(docker.status === 0, 'Docker Compose', docker.status === 0 ? '' : 'install/start Docker Desktop')) failures += 1
for (const [name, host, port] of [['PostgreSQL', '127.0.0.1', 5432], ['Redis', '127.0.0.1', 6379]]) {
  const ok = await portOpen(host, port)
  if (!report(ok, `${name} ${host}:${port}`, ok ? '' : 'run docker compose up -d postgres redis')) failures += 1
}

const migrations = path.join(root, 'packages', 'db', 'supabase', 'migrations')
const migrationFiles = existsSync(migrations) ? readFileSync(path.join(root, 'packages', 'db', 'package.json'), 'utf8').includes('db:migrate') : false
if (!report(migrationFiles, 'migration command', migrationFiles ? 'pnpm --filter @docmee/db db:migrate' : 'missing package/db migration configuration')) failures += 1
if (!report(existsSync(migrations), 'migration directory', migrations)) failures += 1

if (failures) {
  console.error(`Preflight failed with ${failures} problem(s). No services were changed.`)
  process.exitCode = 1
} else {
  console.log('Preflight passed. Next: pnpm --filter @docmee/db db:migrate, then start API, workers, and InboxOS.')
}
}
