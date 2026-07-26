import { describe, it, expect } from 'vitest'
import { orchestrateConversation, routeIntent, type RouteContext } from '../router.js'

const ctx = (over: Partial<RouteContext> = {}): RouteContext => ({
  isInsideBusinessHours: true,
  patientOptedOut: false,
  ...over,
})

describe('routeIntent', () => {
  it('opted-out patient → silence always', () => {
    expect(routeIntent('booking_request', ctx({ patientOptedOut: true }))).toEqual({
      agent: 'silence',
      reason: 'opted_out',
    })
    expect(routeIntent('emergency', ctx({ patientOptedOut: true }))).toEqual({
      agent: 'silence',
      reason: 'opted_out',
    })
  })

  it('outside business hours → silence (except stop_optout)', () => {
    expect(routeIntent('booking_request', ctx({ isInsideBusinessHours: false }))).toEqual({
      agent: 'silence',
      reason: 'outside_hours',
    })
  })

  it('emergency and human handoff still escalate outside business hours', () => {
    const outsideHours = ctx({ isInsideBusinessHours: false })
    expect(routeIntent('emergency', outsideHours)).toEqual({
      agent: 'alertflow',
      reason: 'emergency',
    })
    expect(routeIntent('human_handoff_request', outsideHours)).toEqual({
      agent: 'alertflow',
      reason: 'human_handoff',
    })
  })

  it('stop_optout outside hours → still opts the patient out', () => {
    expect(routeIntent('stop_optout', ctx({ isInsideBusinessHours: false }))).toEqual({
      agent: 'silence',
      reason: 'opted_out',
    })
  })

  it('emergency → alertflow emergency', () => {
    expect(routeIntent('emergency', ctx())).toEqual({ agent: 'alertflow', reason: 'emergency' })
  })

  it('human_handoff_request → alertflow human_handoff', () => {
    expect(routeIntent('human_handoff_request', ctx())).toEqual({
      agent: 'alertflow',
      reason: 'human_handoff',
    })
  })

  it('booking_request → calbot book', () => {
    expect(routeIntent('booking_request', ctx())).toEqual({ agent: 'calbot', action: 'book' })
  })

  it('stop_optout (in hours) → silence opted_out', () => {
    expect(routeIntent('stop_optout', ctx())).toEqual({ agent: 'silence', reason: 'opted_out' })
  })

  it('general_question → botbase (default)', () => {
    expect(routeIntent('general_question', ctx())).toEqual({ agent: 'botbase' })
  })
})

describe('orchestrateConversation', () => {
  it('maps scheduling intents to the booking workflow', () => {
    expect(orchestrateConversation('booking_request', ctx())).toEqual({
      workflow: 'booking',
      route: { agent: 'calbot', action: 'book' },
    })
    expect(orchestrateConversation('reschedule_request', ctx())).toEqual({
      workflow: 'booking',
      route: { agent: 'calbot', action: 'reschedule' },
    })
  })

  it('maps patient and safety escalation to the human-handoff workflow', () => {
    expect(orchestrateConversation('human_handoff_request', ctx())).toEqual({
      workflow: 'human_handoff',
      route: { agent: 'alertflow', reason: 'human_handoff' },
    })
    expect(orchestrateConversation('emergency', ctx())).toEqual({
      workflow: 'human_handoff',
      route: { agent: 'alertflow', reason: 'emergency' },
    })
  })

  it('maps general conversation to the inquiry workflow', () => {
    expect(orchestrateConversation('general_question', ctx())).toEqual({
      workflow: 'inquiry',
      route: { agent: 'botbase' },
    })
  })

  it('keeps consent and business-hours suppression outside the three workflows', () => {
    expect(
      orchestrateConversation('booking_request', ctx({ patientOptedOut: true })),
    ).toEqual({
      workflow: null,
      route: { agent: 'silence', reason: 'opted_out' },
    })
  })

  it('keeps AI safety and human escalation active outside business hours', () => {
    const outsideHours = ctx({ isInsideBusinessHours: false })
    expect(orchestrateConversation('emergency', outsideHours)).toEqual({
      workflow: 'human_handoff',
      route: { agent: 'alertflow', reason: 'emergency' },
    })
    expect(orchestrateConversation('human_handoff_request', outsideHours)).toEqual({
      workflow: 'human_handoff',
      route: { agent: 'alertflow', reason: 'human_handoff' },
    })
  })
})
