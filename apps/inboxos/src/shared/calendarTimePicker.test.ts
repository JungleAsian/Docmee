import { describe, expect, it } from 'vitest'
import { availableMinutesForHour, availableSlotHours, slotForTimeSelection } from './calendarTimePicker'

describe('calendar time picker', () => {
  const slots = [
    { start: '09:00' },
    { start: '09:20' },
    { start: '09:40' },
    { start: '10:00' },
    { start: '10:20' },
  ]

  it('offers only hours returned for the selected doctor working day', () => {
    expect(availableSlotHours(slots)).toEqual(['09', '10'])
  })

  it('keeps minute choices on the configured clinic cadence, including non-hour divisors', () => {
    expect(availableMinutesForHour(slots, '09')).toEqual(['00', '20', '40'])
    expect(availableMinutesForHour(slots, '10')).toEqual(['00', '20'])
  })

  it('returns a start only when the hour and minute represent an available working slot', () => {
    expect(slotForTimeSelection(slots, '09', '20')).toBe('09:20')
    expect(slotForTimeSelection(slots, '09', '30')).toBe('')
  })
})
