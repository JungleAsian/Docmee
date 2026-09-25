import type { HybridKbCandidate } from '../../botbase/kb-retriever.js'

export interface KbRetrievalEvalCase {
  name: string
  language: 'en' | 'es'
  doctorId?: string
  query: string
  expectedContentHash: string
  candidates: HybridKbCandidate[]
}

const candidate = (overrides: Partial<HybridKbCandidate> & Pick<HybridKbCandidate, 'title' | 'content'>): HybridKbCandidate => ({
  similarity: 0,
  vectorScore: 0.82,
  lexicalScore: 0.2,
  language: 'en',
  conflictState: 'clear',
  ...overrides,
})

/** Deliberately separate from implementation tests so changes to ranking are
 * measured against user-shaped questions rather than hand-tuned unit inputs. */
export const KB_RETRIEVAL_EVAL_CASES: KbRetrievalEvalCase[] = [
  {
    name: 'English office hours', language: 'en', query: 'When do you open?', expectedContentHash: 'hours-en',
    candidates: [
      candidate({ title: 'Office hours', content: 'The clinic opens at 9 AM.', contentHash: 'hours-en', vectorScore: .91, lexicalScore: .8, language: 'en', authority: 'clinic' }),
      candidate({ title: 'Direccion', content: 'La clínica está en Main Street.', contentHash: 'location-es', language: 'es' }),
    ],
  },
  {
    name: 'Spanish location', language: 'es', query: '¿Dónde está la clínica?', expectedContentHash: 'location-es',
    candidates: [
      candidate({ title: 'Ubicación', content: 'La clínica está en Main Street.', contentHash: 'location-es', vectorScore: .9, lexicalScore: .7, language: 'es', authority: 'clinic' }),
      candidate({ title: 'Location', content: 'The clinic is on Main Street.', contentHash: 'location-en', vectorScore: .9, lexicalScore: .7, language: 'en', authority: 'clinic' }),
    ],
  },
  {
    name: 'Doctor-specific policy', language: 'en', doctorId: 'doctor-a', query: 'What are Dr A appointment hours?', expectedContentHash: 'doctor-a-hours',
    candidates: [
      candidate({ title: 'Dr A hours', content: 'Dr A sees patients on Tuesday.', contentHash: 'doctor-a-hours', doctorId: 'doctor-a', authority: 'doctor', vectorScore: .88, lexicalScore: .7 }),
      candidate({ title: 'Clinic hours', content: 'The clinic opens Monday.', contentHash: 'clinic-hours', authority: 'clinic', vectorScore: .9, lexicalScore: .7 }),
    ],
  },
  {
    name: 'Exact lexical price', language: 'en', query: 'What is the acne consultation price?', expectedContentHash: 'acne-price',
    candidates: [
      candidate({ title: 'Acne consultation', content: 'The acne consultation costs 50.', contentHash: 'acne-price', vectorScore: .8, lexicalScore: 1 }),
      candidate({ title: 'General services', content: 'The clinic offers consultations.', contentHash: 'services', vectorScore: .93, lexicalScore: .1 }),
    ],
  },
  {
    name: 'Superseded fact excluded', language: 'en', query: 'What is the cancellation window?', expectedContentHash: 'cancel-current',
    candidates: [
      candidate({ title: 'Old cancellation policy', content: 'Cancel 12 hours ahead.', contentHash: 'cancel-old', conflictState: 'superseded', vectorScore: .99, lexicalScore: 1 }),
      candidate({ title: 'Cancellation policy', content: 'Cancel 24 hours ahead.', contentHash: 'cancel-current', vectorScore: .86, lexicalScore: .7 }),
    ],
  },
  {
    name: 'Duplicate current fact collapsed', language: 'en', query: 'Do you take walk-ins?', expectedContentHash: 'walk-in',
    candidates: [
      candidate({ title: 'Walk-ins', content: 'Walk-ins require confirmation.', contentHash: 'walk-in', vectorScore: .9, lexicalScore: .8 }),
      candidate({ title: 'Walk-ins copy', content: 'Walk-ins require confirmation.', contentHash: 'walk-in', vectorScore: .89, lexicalScore: .7 }),
    ],
  },
]
