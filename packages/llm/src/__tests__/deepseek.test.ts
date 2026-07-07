import { describe, it, expect, afterEach } from 'vitest'
import { classifyIntent, type Intent } from '../providers/deepseek.js'

const ALL_INTENTS: Intent[] = [
  'greeting',
  'booking_request',
  'reschedule_request',
  'cancel_request',
  'appointment_status_check',
  'general_question',
  'emergency',
  'human_handoff_request',
  'stop_optout',
  'out_of_scope',
]

describe('classifyIntent', () => {
  const prev = process.env['LLM_STUB']
  afterEach(() => {
    if (prev === undefined) delete process.env['LLM_STUB']
    else process.env['LLM_STUB'] = prev
  })

  it('returns general_question under LLM_STUB', async () => {
    process.env['LLM_STUB'] = 'true'
    expect(await classifyIntent('anything at all')).toBe('general_question')
  })

  it('exposes exactly 10 distinct intents', () => {
    expect(new Set(ALL_INTENTS).size).toBe(10)
  })
})
