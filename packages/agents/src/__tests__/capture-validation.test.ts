import { describe, expect, it } from 'vitest'
import { validCapturedReply } from '../workflows/capture-validation.js'

describe('captured reply validation', () => {
  it.each([
    ['email', 'patient@example.com', true],
    ['email', 'not an email', false],
    ['email', 'a@@example.com', false],
    ['email', 'a@example', false],
    ['number', '12.5', true],
    ['number', '-2', true],
    ['number', 'zero', false],
    ['number', 'Infinity', false],
    ['number', '0x10', false],
    ['number', '12 days', false],
    ['typo', 'anything', false],
    ['date', '2028-02-29', true],
    ['date', '2026-02-29', false],
    ['time', '23:59', true],
    ['time', '24:00', false],
    ['phone', '+1 (202) 555-0100', true],
    ['phone', 'abc', false],
    ['yes_no', 'sí', true],
    ['yes_no', 'maybe', false],
    ['required', 'hello', true],
    ['text', 'hello', true],
    ['', 'hello', true],
    ['text', '  ', false],
  ])('%s validates %s as %s', (mode, reply, expected) => {
    expect(validCapturedReply(mode as string, reply as string)).toBe(expected)
  })
})
