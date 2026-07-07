import { Command } from 'commander'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../lib/config.js'
import { log } from '../lib/logger.js'
import { payloadsDir } from '../lib/paths.js'

async function sendPayload(name: string) {
  loadConfig()
  const file = path.join(payloadsDir, `${name}.json`)
  if (!fs.existsSync(file)) throw new Error(`Unknown payload: ${name}`)
  const body = fs.readFileSync(file, 'utf8')
  const secret = process.env.DEV_LICENSE_SIGNING_KEY || 'dev-secret'
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`
  const target = process.env.WEBHOOK_TARGET || 'http://localhost:3001/webhook/whatsapp'
  try {
    const response = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Hub-Signature-256': signature }, body })
    log('webhook', `${name} sent to ${target}: ${response.status}`)
  } catch (error) {
    log('webhook', `${name} send failed: ${(error as Error).message}`, 'warn')
  }
}

export const webhookCmd = new Command('webhook').description('Send local webhook payloads')

webhookCmd.command('send')
  .option('--payload <name>')
  .option('--all')
  .action(async (opts: { payload?: string; all?: boolean }) => {
    const names = opts.all
      ? fs.readdirSync(payloadsDir).filter((file) => file.endsWith('.json')).map((file) => path.basename(file, '.json'))
      : [opts.payload || 'text-message']
    for (const name of names) await sendPayload(name)
  })
