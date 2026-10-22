import { describe, expect, it } from 'vitest'
import { administrativeIntentCandidates, assessAdministrativeIntent } from '../laya/intents.js'
import { createLayaAdapter } from '../laya/adapter.js'

describe('administrative LAYA intents', () => {
  it('can qualify booking with the full seven-category catalog', async () => {
    const adapter = createLayaAdapter({ readControls: async () => ({
      enabled: true, maximumMode: 'live', clinicMode: 'live', tasks: ['administrative_intent'],
      qualification: { reviewed: true, modelVersion: 'm1', calibrationVersion: 'c1', thresholds: { 'administrative_intent:en': 0.9 } },
    }), transport: async request => ({ schemaVersion: 1, requestId: request.requestId,
      modelVersion: 'm1', calibrationVersion: 'c1', choiceId: 'booking', rawScore: 0.99, abstain: false }) })
    expect(await assessAdministrativeIntent(adapter, { clinicId: 'a', text: 'Book please', language: 'en' }))
      .toMatchObject({ outcome: 'suggestion', choiceId: 'booking', apply: true })
  })

  it('includes unclear and unsupported instead of forcing an action category', () => {
    expect(administrativeIntentCandidates.map(option => option.id)).toEqual([
      'booking', 'reschedule', 'cancel', 'clinic_information', 'secretary', 'unclear', 'unsupported',
    ])
  })

  it.each(['unclear', 'unsupported'])('never applies %s to an action route', async choiceId => {
    const adapter = createLayaAdapter({ readControls: async () => ({
      enabled: true, maximumMode: 'live', clinicMode: 'live', tasks: ['administrative_intent'],
      qualification: { reviewed: true, modelVersion: 'm1', calibrationVersion: 'c1', thresholds: { 'administrative_intent:en': 0.9 } },
    }), transport: async request => ({ schemaVersion: 1, requestId: request.requestId,
      modelVersion: 'm1', calibrationVersion: 'c1', choiceId, rawScore: 0.99, abstain: false }) })
    const result = await assessAdministrativeIntent(adapter, { clinicId: 'a', text: 'hello', language: 'en' })
    expect(result).toMatchObject({ apply: false, reason: 'uncertain' })
  })
})
