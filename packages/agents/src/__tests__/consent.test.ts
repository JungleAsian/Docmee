import { describe, it, expect } from 'vitest'
import { isOptOutMessage, isOptInMessage, optInConfirmation } from '../consent.js'

describe('isOptOutMessage', () => {
  it('detects bare STOP commands in ES and EN', () => {
    expect(isOptOutMessage('STOP')).toBe(true)
    expect(isOptOutMessage('stop')).toBe(true)
    expect(isOptOutMessage('¡STOP!')).toBe(true)
    expect(isOptOutMessage('baja')).toBe(true)
    expect(isOptOutMessage('Dar de baja')).toBe(true)
    expect(isOptOutMessage('cancelar suscripción')).toBe(true)
    expect(isOptOutMessage('no quiero más mensajes')).toBe(true)
    expect(isOptOutMessage('unsubscribe')).toBe(true)
  })

  it('does NOT fire on appointment-cancel phrasing or ordinary questions', () => {
    // Must still reach calbot to cancel an appointment, not opt out.
    expect(isOptOutMessage('quiero cancelar mi cita')).toBe(false)
    expect(isOptOutMessage('cancel my appointment please')).toBe(false)
    // "stop" inside a sentence is not a command.
    expect(isOptOutMessage('can I stop by the clinic tomorrow?')).toBe(false)
    expect(isOptOutMessage('Hola, ¿cuáles son sus horarios?')).toBe(false)
  })
})

describe('isOptInMessage', () => {
  it('detects re-subscribe commands in ES and EN', () => {
    expect(isOptInMessage('START')).toBe(true)
    expect(isOptInMessage('alta')).toBe(true)
    expect(isOptInMessage('Reactivar mensajes')).toBe(true)
    expect(isOptInMessage('quiero recibir mensajes')).toBe(true)
    expect(isOptInMessage('subscribe')).toBe(true)
  })

  it('does not fire on ordinary messages', () => {
    expect(isOptInMessage('quiero empezar mi tratamiento')).toBe(false)
    expect(isOptInMessage('let us start the consultation')).toBe(false)
  })
})

describe('optInConfirmation', () => {
  it('is localized', () => {
    expect(optInConfirmation('es')).toMatch(/mensajes/i)
    expect(optInConfirmation('en')).toMatch(/messages/i)
  })
})
