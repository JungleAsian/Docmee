import { Command } from 'commander'
import { closeDiscordClient, sendNotification, type DiscordNotificationType } from '../../../discord/src/bot.js'
import { log } from '../lib/logger.js'

export const discordCmd = new Command('discord').description('Send DevTools Discord notifications')

function normalizeType(type: string): DiscordNotificationType {
  if (type === 'critical' || type === 'development' || type === 'approval' || type === 'stack') return type
  throw new Error('Type must be critical, development, approval, or stack')
}

discordCmd.command('test')
  .option('--type <type>', 'critical, development, approval, or stack', 'development')
  .action(async (opts: { type: string }) => {
    const type = normalizeType(opts.type)
    try {
      const sent = await sendNotification(`Docmee DevTools test notification - ${new Date().toLocaleString()}`, type)
      if (!sent) {
        log('discord', 'Test notification failed. Check DISCORD_MESSAGING_BOT_TOKEN, channel IDs, and bot channel access.', 'warn')
        process.exitCode = 1
        return
      }
      log('discord', `Test ${type} notification sent`)
    } finally {
      await closeDiscordClient()
    }
  })

discordCmd.command('send')
  .requiredOption('--message <message>')
  .option('--type <type>', 'critical, development, approval, or stack', 'development')
  .action(async (opts: { message: string; type: string }) => {
    const type = normalizeType(opts.type)
    try {
      const sent = await sendNotification(opts.message, type)
      if (!sent) {
        log('discord', 'Notification failed. Check DISCORD_MESSAGING_BOT_TOKEN, channel IDs, and bot channel access.', 'warn')
        process.exitCode = 1
        return
      }
      log('discord', `${type} notification sent`)
    } finally {
      await closeDiscordClient()
    }
  })
