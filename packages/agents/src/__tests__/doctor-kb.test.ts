import { describe, it, expect } from 'vitest'
import {
  detectDoctorId,
  scopeChunksToDoctor,
  scopeKbToMessage,
  hasDoctorScopedChunks,
  type DoctorRef,
} from '../botbase/doctor-kb.js'

const DOCTORS: DoctorRef[] = [
  { id: 'doc-garcia', name: 'Dra. Ana García' },
  { id: 'doc-lopez', name: 'Dr. Luis López' },
]

interface Chunk {
  title: string
  doctorId?: string | null
}

const CLINIC_WIDE: Chunk = { title: 'Horarios', doctorId: null }
const GARCIA_FAQ: Chunk = { title: 'García video', doctorId: 'doc-garcia' }
const LOPEZ_FAQ: Chunk = { title: 'López idiomas', doctorId: 'doc-lopez' }

describe('detectDoctorId', () => {
  it('matches a doctor by a single surname token', () => {
    expect(detectDoctorId('¿La doctora García hace videollamadas?', DOCTORS)).toBe('doc-garcia')
  })

  it('matches by full name and is case-insensitive', () => {
    expect(detectDoctorId('quiero con DR. LUIS LÓPEZ'.toLowerCase(), DOCTORS)).toBe('doc-lopez')
  })

  it('returns null when no doctor is named', () => {
    expect(detectDoctorId('¿Cuál es el horario de la clínica?', DOCTORS)).toBeNull()
  })

  it('does not match a too-short token fragment', () => {
    // No name token of length >= 3 appears in this message.
    expect(detectDoctorId('hola, una consulta general', DOCTORS)).toBeNull()
  })
})

describe('hasDoctorScopedChunks', () => {
  it('is true only when some chunk carries a doctorId', () => {
    expect(hasDoctorScopedChunks([CLINIC_WIDE])).toBe(false)
    expect(hasDoctorScopedChunks([CLINIC_WIDE, GARCIA_FAQ])).toBe(true)
  })
})

describe('scopeChunksToDoctor', () => {
  const all = [CLINIC_WIDE, GARCIA_FAQ, LOPEZ_FAQ]

  it('keeps clinic-wide + the active doctor, drops other doctors', () => {
    const scoped = scopeChunksToDoctor(all, 'doc-garcia')
    expect(scoped).toEqual([CLINIC_WIDE, GARCIA_FAQ])
  })

  it('with no active doctor keeps only clinic-wide chunks', () => {
    expect(scopeChunksToDoctor(all, null)).toEqual([CLINIC_WIDE])
  })
})

describe('scopeKbToMessage', () => {
  const all = [CLINIC_WIDE, GARCIA_FAQ, LOPEZ_FAQ]

  it('surfaces only the named doctor’s FAQ alongside clinic-wide content', () => {
    expect(scopeKbToMessage('¿García atiende en inglés?', all, DOCTORS)).toEqual([
      CLINIC_WIDE,
      GARCIA_FAQ,
    ])
  })

  it('drops all doctor-specific FAQs for a generic question', () => {
    expect(scopeKbToMessage('¿Tienen estacionamiento?', all, DOCTORS)).toEqual([CLINIC_WIDE])
  })

  it('is a no-op when no chunk is doctor-scoped (back-compat)', () => {
    const clinicOnly = [CLINIC_WIDE, { title: 'Servicios', doctorId: null }]
    expect(scopeKbToMessage('cualquier mensaje', clinicOnly, DOCTORS)).toBe(clinicOnly)
  })
})
