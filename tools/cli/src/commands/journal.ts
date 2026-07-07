import { Command } from 'commander'
import { log } from '../lib/logger.js'
import { addEntry, readJournal, removeEntry, setPinned, type JournalType } from '../lib/journal.js'

const TYPES: JournalType[] = ['note', 'decision', 'blocker', 'summary']

export const journalCmd = new Command('journal').description('Project memory / journal — decisions, blockers, notes, summaries')

journalCmd
  .command('list')
  .description('List journal entries (pinned first, then newest)')
  .option('--type <type>', `Filter by type (${TYPES.join(' | ')})`)
  .option('--limit <n>', 'How many to show', '30')
  .action((opts: { type?: string; limit?: string }) => {
    let entries = readJournal()
    if (opts.type) entries = entries.filter((e) => e.type === opts.type)
    entries = entries.slice().sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.ts.localeCompare(a.ts))
    entries = entries.slice(0, Number(opts.limit) || 30)
    if (entries.length === 0) { log('journal', 'No entries.'); return }
    console.table(entries.map((e) => ({
      pin: e.pinned ? '📌' : '',
      type: e.type,
      title: e.title.length > 50 ? `${e.title.slice(0, 47)}…` : e.title,
      task: e.taskId ?? '',
      date: e.ts.replace('T', ' ').replace(/\..*$/, '')
    })))
  })

journalCmd
  .command('add')
  .description('Add a journal entry')
  .requiredOption('--title <title>')
  .option('--type <type>', `${TYPES.join(' | ')}`, 'note')
  .option('--body <body>')
  .option('--tags <tags>', 'comma-separated')
  .option('--task <id>')
  .action((opts: { title: string; type?: string; body?: string; tags?: string; task?: string }) => {
    const type = (TYPES.includes(opts.type as JournalType) ? opts.type : 'note') as JournalType
    const entry = addEntry({
      type,
      title: opts.title,
      body: opts.body,
      tags: opts.tags ? opts.tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
      taskId: opts.task !== undefined ? Number(opts.task) : undefined
    })
    log('journal', `Added ${type}: ${entry.title}`)
  })

journalCmd
  .command('pin')
  .description('Pin or unpin an entry')
  .requiredOption('--id <id>')
  .option('--off', 'Unpin instead of pin')
  .action((opts: { id: string; off?: boolean }) => {
    const ok = setPinned(opts.id, !opts.off)
    log('journal', ok ? `${opts.off ? 'Unpinned' : 'Pinned'} ${opts.id}` : `Entry ${opts.id} not found`, ok ? 'info' : 'error')
    if (!ok) process.exitCode = 1
  })

journalCmd
  .command('remove')
  .description('Delete an entry')
  .requiredOption('--id <id>')
  .action((opts: { id: string }) => {
    const ok = removeEntry(opts.id)
    log('journal', ok ? `Removed ${opts.id}` : `Entry ${opts.id} not found`, ok ? 'info' : 'error')
    if (!ok) process.exitCode = 1
  })
