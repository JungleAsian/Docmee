import { describe, expect, it } from 'vitest'
import { dynamicMenuPage, resolveDynamicMenuReply, selectedDoctorOffersService } from '../workflow-runner.worker.js'

const items = Array.from({ length: 11 }, (_, index) => ({
  id: `doctor-${index + 1}`,
  title: `Dr. ${index + 1}`,
  description: index === 0 ? 'Dermatology' : undefined,
}))

describe('dynamicMenuPage', () => {
  it('paginates current entity options and reserves room for More', () => {
    expect(dynamicMenuPage(items, 0, 8)).toEqual({ items: items.slice(0, 8), hasMore: true })
    expect(dynamicMenuPage(items, 1, 8)).toEqual({ items: items.slice(8), hasMore: false })
  })

  it('bounds page size to WhatsApp list capacity minus the More row', () => {
    expect(dynamicMenuPage(items, 0, 99).items).toHaveLength(9)
  })
})

describe('resolveDynamicMenuReply', () => {
  const pageItems = items.slice(0, 3)

  it('returns stable id and visible label for tapped ids, typed labels, and numeric fallback', () => {
    expect(resolveDynamicMenuReply(pageItems, 'doctor-2', '')).toEqual({ outcome: 'selected', value: 'doctor-2', label: 'Dr. 2' })
    expect(resolveDynamicMenuReply(pageItems, undefined, ' dr. 3 ')).toEqual({ outcome: 'selected', value: 'doctor-3', label: 'Dr. 3' })
    expect(resolveDynamicMenuReply(pageItems, undefined, '2')).toEqual({ outcome: 'selected', value: 'doctor-2', label: 'Dr. 2' })
  })

  it('resolves pagination, restart, handoff, and unknown input', () => {
    expect(resolveDynamicMenuReply(pageItems, '__more__', '')).toEqual({ outcome: 'more' })
    expect(resolveDynamicMenuReply(pageItems, undefined, 'See more')).toEqual({ outcome: 'more' })
    expect(resolveDynamicMenuReply(pageItems, undefined, '0')).toEqual({ outcome: 'restart' })
    expect(resolveDynamicMenuReply(pageItems, undefined, '1')).toEqual({ outcome: 'livechat' })
    expect(resolveDynamicMenuReply(pageItems, undefined, 'unknown')).toEqual({ outcome: 'default' })
  })
})

describe('selectedDoctorOffersService', () => {
  it('accepts only a currently enabled service returned for the selected doctor', () => {
    const enabled = [{ id: 'service-enabled' }, { id: 'service-other' }]
    expect(selectedDoctorOffersService(enabled, 'service-enabled')).toBe(true)
    expect(selectedDoctorOffersService(enabled, 'service-disabled')).toBe(false)
    expect(selectedDoctorOffersService(enabled, '')).toBe(false)
  })
})
