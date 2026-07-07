import { describe, it, expect } from 'vitest'
import { routeIntent, type RouteContext } from '../router.js'

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
