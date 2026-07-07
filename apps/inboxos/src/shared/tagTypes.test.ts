import { describe, it, expect } from 'vitest'
import { TAG_TYPES, tagColor, tagLabel } from './tagTypes'

// Tags the workers apply automatically (agent-processor / scheduling-processor).
// Each MUST exist in the palette so the TagsPanel — which renders ONLY palette
// entries — actually shows the flag, and so tagLabel/tagColor give a localized
// label + meaningful colour instead of the generic DB default. A worker tag
// missing here renders as an invisible (TagsPanel) or raw-string (patient page)
// flag, which for the safety tags (Req 18/19/20) is a real product gap.
const WORKER_APPLIED_TAGS = [
  'emergency',
  'medical_safety',
  'patient_upset',
  'opted_out',
  'new_patient',
  'appointment_scheduled',
] as const

describe('TAG_TYPES palette', () => {
  it('includes every worker-applied tag', () => {
    const names = new Set(TAG_TYPES.map((t) => t.name))
    for (const tag of WORKER_APPLIED_TAGS) {
      expect(names.has(tag)).toBe(true)
    }
  })

  it('flags the medical-safety + emergency tags with a danger colour (Req 20)', () => {
    expect(tagColor('medical_safety')).toBe('#dc2626')
    expect(tagColor('emergency')).toBe('#dc2626')
  })

  it('localizes worker-applied tag labels in both languages', () => {
    expect(tagLabel('medical_safety', 'es')).toBe('Seguridad médica')
    expect(tagLabel('medical_safety', 'en')).toBe('Medical safety')
    expect(tagLabel('emergency', 'es')).toBe('Emergencia')
    expect(tagLabel('emergency', 'en')).toBe('Emergency')
  })

  it('falls back to the raw name + default colour for an unknown tag', () => {
    expect(tagLabel('not_a_real_tag', 'en')).toBe('not_a_real_tag')
    expect(tagColor('not_a_real_tag')).toBe('#14b8a6')
  })

  it('has no duplicate tag names', () => {
    const names = TAG_TYPES.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
  })
})
