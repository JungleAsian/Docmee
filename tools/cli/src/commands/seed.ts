import { Command } from 'commander'
import { randomUUID } from 'node:crypto'
import { writeJson } from '../lib/json-store.js'
import { log } from '../lib/logger.js'

type SeedKind = 'clinic' | 'patient' | 'conversation'

function seed(kind: SeedKind, count: number) {
  const ids = Array.from({ length: count }, () => `${kind}_${randomUUID()}`)
  const today = new Date().toISOString().split('T')[0]
  writeJson(`seed-${today}.json`, { kind, ids, createdAt: new Date().toISOString() })
  log('seed', `Seeded ${count} ${kind} records: ${ids.join(', ')}`)
}

export const seedCmd = new Command('seed').description('Generate local seed data IDs')

seedCmd.command('clinic').action(() => seed('clinic', 2))
seedCmd.command('patient').action(() => seed('patient', 10))
seedCmd.command('conversation').action(() => seed('conversation', 20))
seedCmd.command('all').action(() => {
  seed('clinic', 2)
  seed('patient', 10)
  seed('conversation', 20)
})
