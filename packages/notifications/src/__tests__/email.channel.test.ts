import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { sendEmail } from '../channels/email.channel.js'

const resendSend = vi.hoisted(() => vi.fn())
vi.mock('resend', () => ({
  Resend: class {
    emails = { send: resendSend }
  },
}))

describe('sendEmail', () => {
  beforeEach(() => {
    delete process.env['RESEND_API_KEY']
    process.env['LLM_STUB'] = 'true'
    resendSend.mockReset()
  })
  afterEach(() => {
    delete process.env['LLM_STUB']
  })

  it('LLM_STUB=true → no API call, resolves without error even without an API key', async () => {
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'hi', html: '<p>hi</p>' }),
    ).resolves.toBeUndefined()
  })

  it('requires a provider id before treating a resolved response as accepted', async () => {
    delete process.env['LLM_STUB']
    resendSend.mockResolvedValue({ data: null, error: { message: 'rejected', name: 'validation_error' } })
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'hi', html: '<p>hi</p>' }),
    ).rejects.toThrow('Email provider rejected delivery')
  })

  it('accepts only a response carrying the provider email id', async () => {
    delete process.env['LLM_STUB']
    resendSend.mockResolvedValue({ data: { id: 'email-1' }, error: null })
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'hi', html: '<p>hi</p>' }),
    ).resolves.toBeUndefined()
  })
})
