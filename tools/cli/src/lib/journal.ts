import fs from 'node:fs'
import path from 'node:path'
import { logsDir } from './paths.js'

// Project "second brain": curated, durable memory the dashboard surfaces so
// agents/sessions don't start cold — decisions, blockers, notes, and summaries.
// Distinct from the activity feed (auto event stream); journal is hand-curated.
export type JournalType = 'note' | 'decision' | 'blocker' | 'summary'

export type JournalEntry = {
  id: string
  ts: string
  type: JournalType
  title: string
  body?: string
  tags?: string[]
  taskId?: number
  pinned?: boolean
}

const file = path.join(logsDir, 'journal.json')

export function readJournal(): JournalEntry[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as JournalEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(list: JournalEntry[]) {
  fs.mkdirSync(logsDir, { recursive: true })
  fs.writeFileSync(file, `${JSON.stringify(list, null, 2)}\n`)
}

export function addEntry(entry: { type: JournalType; title: string; body?: string; tags?: string[]; taskId?: number }): JournalEntry {
  const list = readJournal()
  const created: JournalEntry = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    ts: new Date().toISOString(),
    type: entry.type,
    title: entry.title,
    ...(entry.body ? { body: entry.body } : {}),
    ...(entry.tags && entry.tags.length ? { tags: entry.tags } : {}),
    ...(typeof entry.taskId === 'number' ? { taskId: entry.taskId } : {})
  }
  list.push(created)
  write(list)
  return created
}

export function removeEntry(id: string): boolean {
  const list = readJournal()
  const next = list.filter((e) => e.id !== id)
  if (next.length === list.length) return false
  write(next)
  return true
}

export function setPinned(id: string, pinned: boolean): boolean {
  const list = readJournal()
  const entry = list.find((e) => e.id === id)
  if (!entry) return false
  entry.pinned = pinned
  write(list)
  return true
}
