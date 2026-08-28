type SlotStart = { start: string }

/**
 * Builds the HH/MM controls from the API's already schedule- and cadence-filtered
 * slots. This keeps manual entry inside the selected doctor's working hours.
 */
export function availableSlotHours(slots: SlotStart[]): string[] {
  return [...new Set(slots.map((slot) => slot.start.slice(0, 2)))].sort()
}

export function availableMinutesForHour(slots: SlotStart[], hour: string): string[] {
  return slots
    .filter((slot) => slot.start.slice(0, 2) === hour)
    .map((slot) => slot.start.slice(3, 5))
    .filter((minute, index, minutes) => minutes.indexOf(minute) === index)
    .sort()
}

export function slotForTimeSelection(slots: SlotStart[], hour: string, minute: string): string {
  const start = `${hour}:${minute}`
  return slots.some((slot) => slot.start === start) ? start : ''
}
