import { describe, it, expect } from 'vitest'
import {
  errorReviewMeta,
  errorTypeLabelKey,
  humanizeErrorType,
  isDeliveryFailure,
  isPatientSafety,
  queueStats,
} from './errorReviewMeta'
import type { ErrorReview } from './types'

function err(overrides: Partial<ErrorReview>): ErrorReview {
  return {
    id: 'e-1',
    clinicId: 'c-1',
    errorType: 'unanswered_question',
    errorMessage: '¿hacen radiografías el sábado?',
    stackTrace: null,
    context: {},
    status: 'open',
    reviewedBy: null,
    resolvedAt: null,
    createdAt: '2026-06-21T09:00:00.000Z',
    ...overrides,
  }
}

describe('isDeliveryFailure / isPatientSafety', () => {
  it('flags send + delivery failures', () => {
    expect(isDeliveryFailure('whatsapp_send_failed')).toBe(true)
    expect(isDeliveryFailure('meta_send_failure')).toBe(true)
    expect(isDeliveryFailure('whatsapp_delivery_failure')).toBe(true)
    expect(isDeliveryFailure('unanswered_question')).toBe(false)
  })

  it('treats safety/medical and unresolved intent as patient-safety', () => {
    expect(isPatientSafety('medical_safety')).toBe(true)
    expect(isPatientSafety('intent_unresolved')).toBe(true)
    expect(isPatientSafety('template_rejected')).toBe(false)
  })
})

describe('errorTypeLabelKey / humanizeErrorType', () => {
  it('maps known worker codes to a localized label key', () => {
    expect(errorTypeLabelKey('whatsapp_send_failed')).toBe('errors.type.sendFailed')
    expect(errorTypeLabelKey('transcription_failure')).toBe('errors.type.transcription')
    expect(errorTypeLabelKey('no_kb_match')).toBe('errors.type.unanswered')
    expect(errorTypeLabelKey('gcal_booking_conflict')).toBe('errors.type.calendar')
  })

  it('returns null for unknown codes so the UI humanizes them', () => {
    expect(errorTypeLabelKey('some_new_code')).toBeNull()
    expect(humanizeErrorType('some_new_code')).toBe('Some New Code')
  })
})

describe('errorReviewMeta', () => {
  it('marks an unresolved intent as urgent + patient-safety + human mode', () => {
    const meta = errorReviewMeta(err({ errorType: 'intent_unresolved' }))
    expect(meta.urgent).toBe(true)
    expect(meta.patientSafety).toBe(true)
    expect(meta.mode).toBe('human')
  })

  it('marks a send failure as urgent + handoff-pending in bot mode', () => {
    const meta = errorReviewMeta(
      err({ errorType: 'whatsapp_send_failed', errorMessage: 'rejected by Meta', context: { channel: 'whatsapp', recipient: '+34 612' } }),
    )
    expect(meta.urgent).toBe(true)
    expect(meta.handoffPending).toBe(true)
    expect(meta.mode).toBe('bot')
    expect(meta.contact.phone).toBe('+34 612')
    expect(meta.contact.channel).toBe('whatsapp')
  })

  it('honours an explicit human-mode context flag', () => {
    const meta = errorReviewMeta(err({ errorType: 'gcal_booking_conflict', context: { botPaused: true } }))
    expect(meta.mode).toBe('human')
  })

  it('uses the inbound message as the conversation excerpt for unanswered questions', () => {
    const meta = errorReviewMeta(err({ errorType: 'unanswered_question' }))
    expect(meta.patientMessage).toBe('¿hacen radiografías el sábado?')
  })

  it('does not mark resolved errors as urgent or handoff-pending', () => {
    const meta = errorReviewMeta(err({ errorType: 'whatsapp_send_failed', status: 'resolved' }))
    expect(meta.urgent).toBe(false)
    expect(meta.handoffPending).toBe(false)
    expect(meta.resolved).toBe(true)
  })
})

describe('queueStats', () => {
  const now = new Date('2026-06-21T10:00:00.000Z').getTime()

  it('rolls up urgent / open / handoff / resolved-7d and distinct patients', () => {
    const errors: ErrorReview[] = [
      err({ id: 'a', errorType: 'intent_unresolved', context: { recipient: '+1' } }),
      err({ id: 'b', errorType: 'whatsapp_send_failed', context: { recipient: '+2' } }),
      err({ id: 'c', errorType: 'no_kb_match', context: { recipient: '+2' } }), // same patient as b
      err({ id: 'd', errorType: 'template_rejected', status: 'resolved', resolvedAt: '2026-06-20T10:00:00.000Z' }),
      err({ id: 'e', errorType: 'template_rejected', status: 'resolved', resolvedAt: '2026-05-01T10:00:00.000Z' }), // > 7d ago
    ]
    const stats = queueStats(errors, now)
    expect(stats.open).toBe(3)
    expect(stats.urgent).toBe(2) // intent_unresolved + send_failed
    expect(stats.handoff).toBe(1) // send_failed only
    expect(stats.resolved7d).toBe(1) // d within 7d, e excluded
    expect(stats.patientCount).toBe(2) // +1 and +2 (deduped)
  })
})
