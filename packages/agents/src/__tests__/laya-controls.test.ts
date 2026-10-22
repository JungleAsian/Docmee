import { describe, expect, it } from 'vitest'
import { createLayaAdapter, type LayaControls } from '../laya/adapter.js'
import { createLayaControlsReader, resolveLayaControls } from '../laya/controls.js'

const qualification: LayaControls['qualification'] = {
  reviewed: true, modelVersion: 'model-v1', calibrationVersion: 'heldout-v1',
  thresholds: { 'administrative_intent:es': 0.9 },
}
const row = (clinicId: string | null, mode = 'live', tasks = ['administrative_intent']) => ({
  name: 'docmee_laya', clinicId, enabled: true, rolloutPercentage: 100,
  metadata: { schemaVersion: 1, mode, tasks },
})
const rows = () => [row(null), row('clinic-a')]
const input = { clinicId: 'clinic-a', task: 'administrative_intent' as const, language: 'es' as const,
  text: 'Quiero una cita', candidates: [{ id: 'booking', label: 'Reservar una cita' }] }

describe('durable LAYA controls', () => {
  it('requires both global authorization and explicit clinic opt-in', () => {
    expect(resolveLayaControls('clinic-a', rows(), qualification)).toMatchObject({
      enabled: true, maximumMode: 'live', clinicMode: 'live', tasks: ['administrative_intent'],
    })
    for (const partial of [[], [row(null)], [row('clinic-a')], [row(null), row('clinic-b')]]) {
      expect(resolveLayaControls('clinic-a', partial, qualification).enabled).toBe(false)
    }
  })

  it.each([null, 'clinic-a'])('cannot override a disabled switch at scope %s', scope => {
    const flags = rows().map(flag => flag.clinicId === scope ? { ...flag, enabled: false } : flag)
    expect(resolveLayaControls('clinic-a', flags, qualification).enabled).toBe(false)
  })

  it('caps a live clinic at the global maximum and intersects permitted tasks', async () => {
    const flags = [row(null, 'shadow', ['administrative_intent', 'kb_relevance']), row('clinic-a')]
    const controls = resolveLayaControls('clinic-a', flags, qualification)
    expect(controls.tasks).toEqual(['administrative_intent'])
    const adapter = createLayaAdapter({ readControls: async () => controls, transport: async request => ({
      schemaVersion: 1, requestId: request.requestId, modelVersion: 'model-v1',
      calibrationVersion: 'heldout-v1', choiceId: 'booking', rawScore: 0.99, abstain: false,
    }) })
    expect(await adapter.assess(input)).toMatchObject({ mode: 'shadow', apply: false, reason: 'observe_only' })
    expect(await adapter.assess({ ...input, task: 'kb_relevance' })).toMatchObject({ reason: 'disabled', apply: false })
  })

  it.each([
    { enabled: 'true' }, { rolloutPercentage: 99 }, { metadata: null },
    { metadata: { schemaVersion: 2, mode: 'live', tasks: ['administrative_intent'] } },
    { metadata: { schemaVersion: 1, mode: 'automatic', tasks: ['administrative_intent'] } },
    { metadata: { schemaVersion: 1, mode: 'live', tasks: ['send_message'] } },
    { metadata: { schemaVersion: 1, mode: 'live', tasks: ['administrative_intent', 'administrative_intent'] } },
    { metadata: { schemaVersion: 1, mode: 'live', tasks: ['administrative_intent'], qualification } },
  ])('fails closed for malformed or expanded flag metadata: %j', patch => {
    expect(resolveLayaControls('clinic-a', [row(null), { ...row('clinic-a'), ...patch }], qualification).enabled).toBe(false)
  })

  it.each([null, 'clinic-a'])('rejects ambiguous duplicate rows at scope %s', scope => {
    expect(resolveLayaControls('clinic-a', [...rows(), row(scope)], qualification).enabled).toBe(false)
  })

  it('does not allow database flags to claim independent model qualification', async () => {
    const adapter = createLayaAdapter({ readControls: async () => resolveLayaControls('clinic-a', rows()),
      transport: async request => ({ schemaVersion: 1, requestId: request.requestId,
        modelVersion: 'unconfigured', calibrationVersion: 'unconfigured',
        choiceId: 'booking', rawScore: 1, abstain: false }) })
    expect(await adapter.assess(input)).toMatchObject({ reason: 'unqualified', apply: false })
  })

  it('reads durable flags again after inference so a global kill takes effect immediately', async () => {
    let flags = rows()
    const reader = createLayaControlsReader(async () => flags, qualification)
    const adapter = createLayaAdapter({ readControls: reader, transport: async request => {
      flags = [{ ...row(null), enabled: false }, row('clinic-a')]
      return { schemaVersion: 1, requestId: request.requestId, modelVersion: 'model-v1',
        calibrationVersion: 'heldout-v1', choiceId: 'booking', rawScore: 0.99, abstain: false }
    } })
    expect(await adapter.assess(input)).toMatchObject({ reason: 'controls_changed', apply: false })
    expect(await adapter.assess(input)).toMatchObject({ reason: 'disabled', apply: false })
  })

  it('fails closed on store failure without retaining exception text', async () => {
    const reader = createLayaControlsReader(async () => { throw Error('private database details') }, qualification)
    const result = await reader('clinic-a')
    expect(result.enabled).toBe(false)
    expect(JSON.stringify(result)).not.toContain('private database details')
  })

  it('snapshots server qualification and does not inherit changes to the supplied object', async () => {
    const mutable = structuredClone(qualification)
    const reader = createLayaControlsReader(async () => rows(), mutable)
    mutable.thresholds['administrative_intent:es'] = 0
    const result = await reader('clinic-a')
    expect(result.qualification.thresholds['administrative_intent:es']).toBe(0.9)
    result.qualification.thresholds['administrative_intent:es'] = 0
    expect((await reader('clinic-a')).qualification.thresholds['administrative_intent:es']).toBe(0.9)
  })
})
