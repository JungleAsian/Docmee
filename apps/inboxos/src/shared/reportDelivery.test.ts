import { describe, it, expect } from 'vitest'
import { reportDelivery } from './reportDelivery'

describe('reportDelivery', () => {
  it('emailed=true → sent, regardless of recipient', () => {
    expect(reportDelivery({ emailed: true, recipientEmail: 'a@b.es' })).toBe('sent')
    expect(reportDelivery({ emailed: true, recipientEmail: null })).toBe('sent')
  })

  it('not emailed but a recipient was on file → failed (send attempted, retry exhausted)', () => {
    expect(reportDelivery({ emailed: false, recipientEmail: 'a@b.es' })).toBe('failed')
  })

  it('not emailed and no recipient → notsent (panel only)', () => {
    expect(reportDelivery({ emailed: false, recipientEmail: null })).toBe('notsent')
    expect(reportDelivery({ emailed: false, recipientEmail: '' })).toBe('notsent')
  })
})
