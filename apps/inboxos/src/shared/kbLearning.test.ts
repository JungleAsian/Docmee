import { describe, expect, it } from 'vitest'
import { canReviewLearning, matchesLearningSearch, reviewCommand, reviewUnavailable, rollbackSnapshots, scorePercent, type LearningCandidate, type LearningHistory } from './kbLearning'

const candidate = { id: 'candidate-a', clinicId: 'clinic-a', revision: 7, status: 'pending_review', expiresAt: '2099-01-01T00:00:00Z' } as LearningCandidate
describe('learning review boundaries', () => {
  it('searches loaded original questions, answers and staff edits case-insensitively', () => {
    expect(matchesLearningSearch(' HORARIO ', '¿Cuál es el horario?', 'Open at 8', 'Open at 9')).toBe(true)
    expect(matchesLearningSearch('open at 9', '¿Cuál es el horario?', 'Open at 8', 'Open at 9')).toBe(true)
    expect(matchesLearningSearch('price', '¿Cuál es el horario?', null)).toBe(false)
    expect(matchesLearningSearch(' ', undefined)).toBe(true)
  })
  it('allows only studio administrators or administrators assigned to the selected clinic', () => {
    expect(canReviewLearning(null, 'clinic-a')).toBe(false)
    expect(canReviewLearning({ role: 'secretary', clinicId: 'clinic-a' }, 'clinic-a')).toBe(false)
    expect(canReviewLearning({ role: 'doctor', clinicId: 'clinic-a' }, 'clinic-a')).toBe(false)
    expect(canReviewLearning({ role: 'clinic_admin', clinicId: 'clinic-a' }, 'clinic-b')).toBe(false)
    expect(canReviewLearning({ role: 'clinic_admin', clinicId: 'clinic-a', clinicIds: ['clinic-b'] }, 'clinic-b')).toBe(true)
    expect(canReviewLearning({ role: 'ia_studio_admin', clinicId: 'clinic-a' }, 'clinic-b')).toBe(true)
    expect(canReviewLearning({ role: 'ia_studio_admin', clinicId: 'clinic-a' }, '')).toBe(false)
  })
  it('captures clinic, current candidate and expected revision, not an ancestor target', () => {
    expect(reviewCommand('clinic-a', { ...candidate, status: 'approved' }, 'rollback', '', true, { historyId: 'approved-history' })).toEqual({ clinicId: 'clinic-a', candidateId: 'candidate-a', expectedRevision: 7, action: 'rollback', historyId: 'approved-history', staffConfirmed: true })
  })
  it('blocks cross-clinic, expired and malformed expiry actions', () => {
    expect(() => reviewCommand('clinic-b', candidate, 'edit', 'fact', false)).toThrow('refresh_review')
    for (const expiresAt of ['2000-01-01', 'bad-date']) {
      expect(() => reviewCommand('clinic-a', { ...candidate, expiresAt }, 'reject', '', false)).toThrow('refresh_review')
    }
    expect(reviewUnavailable({ ...candidate, expiresAt: null })).toBe(true)
    expect(reviewUnavailable({ ...candidate, status: 'approved', expiresAt: null })).toBe(false)
  })
  it('requires explicit exact-content confirmation before publication and rollback', () => {
    expect(() => reviewCommand('clinic-a', candidate, 'approve', 'fact', false)).toThrow('confirmation_required')
    expect(() => reviewCommand('clinic-a', { ...candidate, status: 'approved' }, 'rollback', '', true)).toThrow('confirmation_required')
    expect(reviewCommand('clinic-a', candidate, 'approve', ' fact ', true).content).toBe('fact')
  })
  it('does not let read-only superseded or rejected candidates be mutated', () => {
    for (const status of ['superseded', 'rejected'] as const) {
      expect(() => reviewCommand('clinic-a', { ...candidate, status }, 'approve', 'fact', true)).toThrow('refresh_review')
    }
  })
  it('rejects actions inconsistent with the reviewed lifecycle', () => {
    expect(() => reviewCommand('clinic-a', candidate, 'rollback', '', true, { historyId: 'history' })).toThrow('refresh_review')
    for (const action of ['approve', 'reject'] as const) expect(() => reviewCommand('clinic-a', { ...candidate, status: 'approved' }, action, 'fact', true)).toThrow('refresh_review')
  })
  it('requires a structured rejection reason and preserves it in the command', () => {
    expect(() => reviewCommand('clinic-a', candidate, 'reject', '', false)).toThrow('rejection_reason_required')
    expect(() => reviewCommand('clinic-a', candidate, 'reject', '', false, { rejectionReason: 'other' })).toThrow('rejection_detail_required')
    expect(reviewCommand('clinic-a', candidate, 'reject', '', false, { rejectionReason: 'outdated' })).toMatchObject({ action: 'reject', rejectionReason: 'outdated' })
  })
  it('never presents missing or invalid evidence as a measured zero', () => {
    for (const score of [null, undefined, NaN, Infinity, -1, 1.01, '0.8']) expect(scorePercent(score)).toBeNull()
    expect(scorePercent(0)).toBe('0%')
    expect(scorePercent(.8)).toBe('80%')
  })
  it('offers only this candidate approved snapshots for the same current document', () => {
    const current = { ...candidate, status: 'approved' as const, publishedDocumentId: 'doc-a', publishedDocumentVersion: 3 }
    const rows = [
      { id: 'valid', candidateId: 'candidate-a', action: 'approve', documentId: 'doc-a', documentVersion: 1 },
      { id: 'rollback', candidateId: 'candidate-a', action: 'rollback', documentId: 'doc-a', documentVersion: 2 },
      { id: 'unapproved', candidateId: 'candidate-a', action: 'edit', documentId: 'doc-a', documentVersion: 1 },
      { id: 'foreign', candidateId: 'other', action: 'approve', documentId: 'doc-a', documentVersion: 1 },
      { id: 'different', candidateId: 'candidate-a', action: 'approve', documentId: 'other', documentVersion: 1 },
      { id: 'future', candidateId: 'candidate-a', action: 'approve', documentId: 'doc-a', documentVersion: 4 },
    ] as LearningHistory[]
    expect(rollbackSnapshots(current, rows).map(row => row.id)).toEqual(['valid', 'rollback'])
  })
})
