import { describe, expect, it } from 'vitest'
import {
  distinctSlotDates,
  slotsOnDate,
  formatDateLabel,
  formatTimeLabel,
  slotMenuPage,
  todayIso,
  type WorkflowSlot,
} from '../workflow-runner.worker.js'
import type { WorkflowNode } from '@docmee/db'

const node = (config: Record<string, unknown>): WorkflowNode => ({
  id: 'slots',
  kind: 'action',
  type: 'action.offer_slot_menu',
  config,
  x: 0,
  y: 0,
})

const slot = (start: string, end: string): WorkflowSlot => ({ start, end })

describe('todayIso', () => {
  it('returns a YYYY-MM-DD string matching the current UTC date', () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(todayIso()).toBe(new Date().toISOString().slice(0, 10))
  })
})

describe('distinctSlotDates / slotsOnDate', () => {
  const slots = [
    slot('2026-08-11T09:00:00', '2026-08-11T09:30:00'),
    slot('2026-08-10T09:00:00', '2026-08-10T09:30:00'),
    slot('2026-08-10T09:30:00', '2026-08-10T10:00:00'),
  ]

  it('dedupes and sorts distinct dates ascending', () => {
    expect(distinctSlotDates(slots)).toEqual(['2026-08-10', '2026-08-11'])
  })

  it('filters to one date, sorted by start time', () => {
    expect(slotsOnDate(slots, '2026-08-10').map((s) => s.start)).toEqual([
      '2026-08-10T09:00:00',
      '2026-08-10T09:30:00',
    ])
    expect(slotsOnDate(slots, '2026-08-12')).toEqual([])
  })
})

describe('formatDateLabel / formatTimeLabel', () => {
  it('formats an ISO date as a short weekday + month + day', () => {
    expect(formatDateLabel('2026-08-10')).toBe('Mon, Aug 10')
  })

  it('falls back to the raw string on an unparsable date', () => {
    expect(formatDateLabel('not-a-date')).toBe('not-a-date')
  })

  it('formats 24h HH:MM as a 12h clock label', () => {
    expect(formatTimeLabel('09:00')).toBe('9:00 AM')
    expect(formatTimeLabel('13:30')).toBe('1:30 PM')
    expect(formatTimeLabel('00:00')).toBe('12:00 AM')
    expect(formatTimeLabel('12:00')).toBe('12:00 PM')
  })

  it('falls back to the raw string on unparsable time', () => {
    expect(formatTimeLabel('garbage')).toBe('garbage')
  })
})

describe('slotMenuPage', () => {
  const manySlots = ['10', '11', '12', '13', '14', '15', '16', '17', '18', '19'].map((day) =>
    slot(`2026-08-${day}T09:00:00`, `2026-08-${day}T09:30:00`),
  )

  it('mode "date": pages through distinct dates, reserving pageSize per page', () => {
    const n = node({ pickerMode: 'date', pageSize: 3 })
    const ctx = { available_slots: manySlots }
    const page0 = slotMenuPage(n, ctx, 0)
    expect(page0.items.map((i) => i.id)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12'])
    expect(page0.hasMore).toBe(true)

    const page3 = slotMenuPage(n, ctx, 3)
    expect(page3.items.map((i) => i.id)).toEqual(['2026-08-19'])
    expect(page3.hasMore).toBe(false)

    const page4 = slotMenuPage(n, ctx, 4)
    expect(page4.items).toEqual([])
    expect(page4.hasMore).toBe(false)
  })

  it('mode "date": labels each option with a human-readable date', () => {
    const n = node({ pickerMode: 'date', pageSize: 5 })
    const page = slotMenuPage(n, { available_slots: manySlots.slice(0, 1) }, 0)
    expect(page.items).toEqual([{ id: '2026-08-10', title: 'Mon, Aug 10' }])
  })

  it('mode "time": filters to the dateField-selected date and labels 12h times', () => {
    const slots = [
      slot('2026-08-10T09:00:00', '2026-08-10T09:30:00'),
      slot('2026-08-10T13:30:00', '2026-08-10T14:00:00'),
      slot('2026-08-11T09:00:00', '2026-08-11T09:30:00'), // different date, excluded
    ]
    const n = node({ pickerMode: 'time', pageSize: 5 })
    const page = slotMenuPage(n, { available_slots: slots, preferred_date: '2026-08-10' }, 0)
    expect(page.items).toEqual([
      { id: '09:00', title: '9:00 AM' },
      { id: '13:30', title: '1:30 PM' },
    ])
    expect(page.hasMore).toBe(false)
  })

  it('mode "time" respects a custom dateField', () => {
    const slots = [slot('2026-08-10T09:00:00', '2026-08-10T09:30:00')]
    const n = node({ pickerMode: 'time', dateField: 'chosen_date' })
    expect(slotMenuPage(n, { available_slots: slots, chosen_date: '2026-08-10' }, 0).items).toHaveLength(1)
    expect(slotMenuPage(n, { available_slots: slots, preferred_date: '2026-08-10' }, 0).items).toHaveLength(0)
  })

  it('respects a custom slotsField', () => {
    const n = node({ pickerMode: 'date', slotsField: 'doctor_slots' })
    expect(slotMenuPage(n, { doctor_slots: manySlots.slice(0, 2) }, 0).items).toHaveLength(2)
    expect(slotMenuPage(n, { available_slots: manySlots }, 0).items).toHaveLength(0)
  })

  it('returns no items when the context field is missing or malformed', () => {
    expect(slotMenuPage(node({ pickerMode: 'date' }), {}, 0).items).toEqual([])
    expect(slotMenuPage(node({ pickerMode: 'date' }), { available_slots: 'not-an-array' }, 0).items).toEqual([])
  })
})
