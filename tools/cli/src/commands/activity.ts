import { Command } from 'commander'
import { log } from '../lib/logger.js'
import { logActivity, readActivity, clearActivity, type Severity } from '../lib/activity.js'

export const activityCmd = new Command('activity').description('Durable cross-DevTools activity feed (the "what happened" timeline)')

activityCmd
  .command('list')
  .description('Show recent activity events (newest first)')
  .option('--limit <n>', 'How many events to show', '30')
  .option('--actor <actor>', 'Filter by actor')
  .option('--severity <severity>', 'Filter by severity (info | success | warn | error)')
  .action((opts: { limit?: string; actor?: string; severity?: string }) => {
    let events = readActivity().slice().reverse()
    if (opts.actor) events = events.filter((e) => e.actor === opts.actor)
    if (opts.severity) events = events.filter((e) => e.severity === opts.severity)
    events = events.slice(0, Number(opts.limit) || 30)
    if (events.length === 0) { log('activity', 'No activity yet.'); return }
    console.table(events.map((e) => ({
      time: e.ts.replace('T', ' ').replace(/\..*$/, ''),
      actor: e.actor,
      event: e.event,
      severity: e.severity,
      task: e.taskId ?? '',
      message: e.message.length > 70 ? `${e.message.slice(0, 67)}…` : e.message
    })))
  })

activityCmd
  .command('log')
  .description('Append an activity event')
  .requiredOption('--actor <actor>')
  .requiredOption('--event <event>')
  .requiredOption('--message <message>')
  .option('--severity <severity>', 'info | success | warn | error', 'info')
  .option('--task <id>')
  .option('--source <source>')
  .action((opts: { actor: string; event: string; message: string; severity?: string; task?: string; source?: string }) => {
    logActivity({
      actor: opts.actor,
      event: opts.event,
      message: opts.message,
      severity: (['info', 'success', 'warn', 'error'].includes(opts.severity ?? '') ? opts.severity : 'info') as Severity,
      taskId: opts.task !== undefined ? Number(opts.task) : undefined,
      source: opts.source
    })
    log('activity', 'Event logged')
  })

activityCmd
  .command('clear')
  .description('Clear the activity feed')
  .action(() => {
    clearActivity()
    log('activity', 'Activity feed cleared')
  })
