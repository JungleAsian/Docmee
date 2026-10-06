import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')

// These senders are what the workflow worker uses to answer patients during a
// booking. fetch has no default timeout, so one stuck Meta/Twilio call would freeze
// the workflow run; every outbound request must carry an abort signal.
describe('outbound channel sends never hang', () => {
  it.each([
    ['../whatsapp-sender.ts', 3],
    ['../messenger-sender.ts', 1],
    ['../instagram-sender.ts', 1],
    ['../twilio-whatsapp-sender.ts', 1],
  ])('%s bounds every fetch with a timeout', (file, sends) => {
    const source = read(file)
    expect(source.match(/await fetch\(/g)).toHaveLength(sends)
    expect(source.match(/signal: AbortSignal\.timeout\(/g)).toHaveLength(sends)
  })
})
