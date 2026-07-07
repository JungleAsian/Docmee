import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sendEmail } from '../channels/email.channel.js'

describe('sendEmail', () => {
  beforeEach(() => {
    delete process.env['RESEND_API_KEY']
    process.env['LLM_STUB'] = 'true'
  })
  afterEach(() => {
    delete process.env['LLM_STUB']
  })

  it('LLM_STUB=true → no API call, resolves without error even without an API key', async () => {
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'hi', html: '<p>hi</p>' }),
    ).resolves.toBeUndefined()
  })
})
