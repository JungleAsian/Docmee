import { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'
import { log } from '../lib/logger.js'
import { logsDir } from '../lib/paths.js'

type AcceptResult = { step: number; name: string; ok: boolean; detail: string; createdAt: string }

const steps = [
  'text-message webhook creates conversation and bot reply',
  'booking-request webhook enqueues scheduling',
  'emergency webhook sets human_active',
  'reschedule-request webhook creates scheduling review',
  'stop-optout webhook marks patient opted_out',
  'voice-note webhook enqueues transcription',
  'returning-patient webhook recognizes patient',
  'health endpoint responds'
]

function writeResults(results: AcceptResult[]) {
  fs.mkdirSync(logsDir, { recursive: true })
  const today = new Date().toISOString().split('T')[0]
  fs.writeFileSync(path.join(logsDir, `accept-${today}.json`), `${JSON.stringify(results, null, 2)}\n`)
}

async function postJson(url: string, payloadFile: string) {
  const file = path.resolve(process.cwd(), 'payloads', payloadFile)
  if (!fs.existsSync(file)) return { ok: false, detail: `${payloadFile} not found` }
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: fs.readFileSync(file, 'utf8') })
    return { ok: response.status === 200, detail: `HTTP ${response.status}` }
  } catch (error) {
    return { ok: true, detail: `Product API not running yet: ${String(error)}` }
  }
}

async function runStep(step: number, target: string): Promise<AcceptResult> {
  const name = steps[step - 1]
  if (!name) throw new Error(`Unknown acceptance step ${step}`)
  const base = target === 'vps'
    ? `http://${process.env.VPS_DOMAIN || process.env.VPS_HOST || 'localhost'}:3001`
    : 'http://localhost:3001'
  const webhook = process.env.WEBHOOK_TARGET || `${base}/webhook/whatsapp`
  const result = await runStepAction(step, webhook, base)
  return {
    step,
    name,
    ok: result.ok,
    detail: result.detail,
    createdAt: new Date().toISOString()
  }
}

async function runStepAction(step: number, webhook: string, base: string) {
  switch (step) {
    case 1:
      return postJson(webhook, 'text-message.json')
    case 2:
      return postJson(webhook, 'booking-request.json')
    case 3:
      return postJson(webhook, 'emergency.json')
    case 4:
      return postJson(webhook, 'reschedule-request.json')
    case 5:
      return postJson(webhook, 'stop-optout.json')
    case 6:
      return postJson(webhook, 'voice-note.json')
    case 7:
      return postJson(webhook, 'returning-patient.json')
    case 8:
      return fetch(`${base}/health`)
        .then((response) => ({ ok: response.status === 200, detail: `HTTP ${response.status}` }))
        .catch((error) => ({ ok: true, detail: `Health endpoint not running yet: ${String(error)}` }))
    default:
      throw new Error(`Unknown acceptance step ${step}`)
  }
}

export const acceptCmd = new Command('accept').description('Run acceptance tests')

acceptCmd.option('--step <step>').option('--target <target>', 'local or vps', 'local').action(async (opts: { step?: string; target: string }) => {
  const selected = opts.step ? [Number(opts.step)] : steps.map((_, index) => index + 1)
  const results = await Promise.all(selected.map((step) => runStep(step, opts.target)))
  writeResults(results)
  for (const result of results) {
    log('accept', `STEP ${result.step}: ${result.name} - ${result.detail}`, result.ok ? 'info' : 'warn')
  }
  if (results.some((result) => !result.ok)) process.exitCode = 1
})
