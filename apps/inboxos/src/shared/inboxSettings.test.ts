import { describe, expect, it } from 'vitest'
import { readInboxSettings } from './inboxSettings'

describe('readInboxSettings', () => {
  it('shows the new conversation header controls by default', () => {
    const settings = readInboxSettings(undefined)

    expect(settings.patientChatVisibility).toMatchObject({
      headerNextAppointment: true,
      headerPatientHistory: true,
      headerStatusSelector: true,
      headerResolveAction: true,
    })
  })

  it('hides inactive and unconfigured channels by default', () => {
    expect(readInboxSettings(undefined).patientChatVisibility.inactiveChannels).toBe(false)
  })

  it('preserves explicit clinic visibility choices', () => {
    const settings = readInboxSettings({
      patientChatVisibility: {
        headerNextAppointment: false,
        headerPatientHistory: false,
        headerStatusSelector: false,
        headerResolveAction: false,
        inactiveChannels: true,
      },
    })

    expect(settings.patientChatVisibility).toMatchObject({
      headerNextAppointment: false,
      headerPatientHistory: false,
      headerStatusSelector: false,
      headerResolveAction: false,
      inactiveChannels: true,
    })
  })
})
