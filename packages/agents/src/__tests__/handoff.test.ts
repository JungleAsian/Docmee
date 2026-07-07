import { describe, it, expect } from 'vitest'
import { isBotPaused, detectHumanRequest, handoffNotice } from '../handoff.js'

describe('isBotPaused', () => {
  it('bot replies only while the conversation is open', () => {
    expect(isBotPaused('open')).toBe(false)
  })

  it('bot is silent once a human owns or closes the conversation', () => {
    expect(isBotPaused('assigned')).toBe(true)
    expect(isBotPaused('handoff')).toBe(true)
    expect(isBotPaused('resolved')).toBe(true)
  })
})

describe('detectHumanRequest', () => {
  it('detects Spanish requests for a person', () => {
    expect(detectHumanRequest('Quiero hablar con una persona por favor')).toBe(true)
    expect(detectHumanRequest('necesito atención humana')).toBe(true)
    expect(detectHumanRequest('puedo hablar con alguien?')).toBe(true)
  })

  it('detects English requests for a person', () => {
    expect(detectHumanRequest('I want to talk to a human')).toBe(true)
    expect(detectHumanRequest('can I speak to someone')).toBe(true)
    expect(detectHumanRequest('connect me with a real person')).toBe(true)
  })

  it('does not fire on ordinary clinic questions', () => {
    expect(detectHumanRequest('Hola, quiero agendar una cita')).toBe(false)
    expect(detectHumanRequest('What are your opening hours?')).toBe(false)
  })
})

describe('handoffNotice', () => {
  it('is localized', () => {
    expect(handoffNotice('es')).toMatch(/persona/i)
    expect(handoffNotice('en')).toMatch(/clinic/i)
  })
})
