import { describe, expect, it } from 'vitest'
import {
  addShift,
  isDayEnabled,
  removeShift,
  setDayEnabled,
  setShift,
} from './doctorHours'
import type { DoctorAvailability } from './types'

describe('doctorHours editor helpers', () => {
  it('reports day-enabled state from the shift count', () => {
    const value: DoctorAvailability = { mon: [{ start: '09:00', end: '17:00' }] }
    expect(isDayEnabled(value, 'mon')).toBe(true)
    expect(isDayEnabled(value, 'tue')).toBe(false)
    expect(isDayEnabled({ mon: [] }, 'mon')).toBe(false)
  })

  it('enabling a day adds one default shift; disabling removes the day', () => {
    const enabled = setDayEnabled({}, 'wed', true)
    expect(enabled.wed).toEqual([{ start: '09:00', end: '17:00' }])

    const disabled = setDayEnabled(enabled, 'wed', false)
    expect(disabled.wed).toBeUndefined()
    expect('wed' in disabled).toBe(false)
  })

  it('adds a second (afternoon) shift to a day for split schedules', () => {
    const single: DoctorAvailability = { mon: [{ start: '09:00', end: '13:00' }] }
    const split = addShift(single, 'mon')
    expect(split.mon).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '15:00', end: '18:00' },
    ])
    // The original object is untouched (immutability).
    expect(single.mon).toHaveLength(1)
  })

  it('addShift on an off day enables it with a single default shift', () => {
    expect(addShift({}, 'fri').fri).toEqual([{ start: '09:00', end: '17:00' }])
  })

  it('removes a single shift and drops the day when it was the last one', () => {
    const split: DoctorAvailability = {
      mon: [
        { start: '09:00', end: '13:00' },
        { start: '15:00', end: '18:00' },
      ],
    }
    const afterFirstRemoved = removeShift(split, 'mon', 0)
    expect(afterFirstRemoved.mon).toEqual([{ start: '15:00', end: '18:00' }])

    const afterAllRemoved = removeShift(afterFirstRemoved, 'mon', 0)
    expect(afterAllRemoved.mon).toBeUndefined()
    expect('mon' in afterAllRemoved).toBe(false)
  })

  it('patches a single endpoint of one shift, leaving siblings intact', () => {
    const split: DoctorAvailability = {
      tue: [
        { start: '09:00', end: '13:00' },
        { start: '15:00', end: '18:00' },
      ],
    }
    const updated = setShift(split, 'tue', 1, { end: '19:00' })
    expect(updated.tue).toEqual([
      { start: '09:00', end: '13:00' },
      { start: '15:00', end: '19:00' },
    ])
    // Untouched shift kept its identity values; input not mutated.
    expect(split.tue![1].end).toBe('18:00')
  })
})
