import { describe, expect, it } from 'vitest'
import { createLayaAdapter, type LayaControls, type LayaRequest } from '../laya/adapter.js'
import { isObservableTypedReply, layaLanguageOf, menuBranchCandidates, redactPatientText } from '../laya/observations.js'
import { layaQualificationStatus, parseLayaQualification } from '../laya/qualification.js'
import { parseLayaTimeoutMs } from '../laya/server.js'

const watchOnly = { reviewed: false, modelVersion: 'laya-multilingual-e4e9ddf21a7b', calibrationVersion: 'upstream-unqualified-v1', thresholds: {} }

describe('LAYA qualification record', () => {
  it('accepts a watch-only record and reports it as unqualified', () => {
    const parsed = parseLayaQualification(JSON.stringify(watchOnly))
    expect(parsed).toEqual(watchOnly)
    expect(layaQualificationStatus(parsed)).toBe('unqualified')
  })

  it('accepts a reviewed record only with at least one valid threshold', () => {
    const reviewed = { ...watchOnly, reviewed: true, thresholds: { 'workflow_branch:es': 0.82 } }
    expect(layaQualificationStatus(parseLayaQualification(JSON.stringify(reviewed)))).toBe('reviewed')
    expect(parseLayaQualification(JSON.stringify({ ...reviewed, thresholds: {} }))).toBeUndefined()
  })

  it.each([
    undefined, '', 'not json', '[]', JSON.stringify({ ...watchOnly, extra: true }),
    JSON.stringify({ ...watchOnly, reviewed: 'yes' }),
    JSON.stringify({ ...watchOnly, modelVersion: 'has spaces' }),
    JSON.stringify({ ...watchOnly, thresholds: { 'workflow_branch:fr': 0.5 } }),
    JSON.stringify({ ...watchOnly, thresholds: { 'workflow_branch:es': 1.5 } }),
  ])('treats a malformed record as unconfigured: %s', raw => {
    expect(parseLayaQualification(raw)).toBeUndefined()
    expect(layaQualificationStatus(parseLayaQualification(raw))).toBe('unconfigured')
  })
})

describe('LAYA watch-only adapter results', () => {
  const controls = (qualification: LayaControls['qualification'], mode: LayaControls['clinicMode'] = 'live'): LayaControls => ({
    enabled: true, maximumMode: 'live', clinicMode: mode, tasks: ['administrative_intent'], qualification,
  })
  const input = { clinicId: 'clinic-a', task: 'administrative_intent' as const, language: 'es' as const,
    text: 'Quiero una cita', candidates: [{ id: 'booking', label: 'Book' }, { id: 'secretary', label: 'Secretary' }] }
  const transport = async (request: LayaRequest) => ({ schemaVersion: 1, requestId: request.requestId,
    modelVersion: watchOnly.modelVersion, calibrationVersion: watchOnly.calibrationVersion, choiceId: 'booking', rawScore: 0.7, abstain: false })

  it('exposes the unqualified pick for logging but never applies it, even in live mode', async () => {
    const adapter = createLayaAdapter({ readControls: async () => controls(watchOnly), transport })
    expect(await adapter.assess(input)).toEqual({ outcome: 'fallback', reason: 'unqualified', mode: 'live', apply: false,
      rawScore: 0.7, observedChoiceId: 'booking' })
  })

  it('exposes a below-threshold pick for logging without applying it', async () => {
    const reviewed = { ...watchOnly, reviewed: true, thresholds: { 'administrative_intent:es': 0.9 } }
    const adapter = createLayaAdapter({ readControls: async () => controls(reviewed), transport })
    expect(await adapter.assess(input)).toMatchObject({ reason: 'uncertain', apply: false, observedChoiceId: 'booking' })
  })

  it('rejects responses when no record is installed (versions cannot match)', async () => {
    const unconfigured = { reviewed: false, modelVersion: 'unconfigured', calibrationVersion: 'unconfigured', thresholds: {} }
    const adapter = createLayaAdapter({ readControls: async () => controls(unconfigured, 'shadow'), transport })
    const result = await adapter.assess(input)
    expect(result).toMatchObject({ reason: 'invalid_response', apply: false })
    expect(result.observedChoiceId).toBeUndefined()
  })
})

describe('LAYA observation helpers', () => {
  it('redacts emails, links, phone numbers and long numbers', () => {
    expect(redactPatientText('Mi correo es ana.p@mail.com y mi cel +502 5555-1234, DPI 2345678901234'))
      .toBe('Mi correo es [email] y mi cel [phone], DPI [phone]')
    expect(redactPatientText('see https://x.example/a?b=1 now')).toBe('see [link] now')
    expect(redactPatientText('cita a las 3 pm el 12/11')).toBe('cita a las 3 pm el 12/11')
    expect(redactPatientText('code 123456')).toBe('code [number]')
  })

  it('buckets language coarsely', () => {
    expect(layaLanguageOf('Quiero una cita por favor')).toBe('es')
    expect(layaLanguageOf('I want to book an appointment')).toBe('en')
    expect(layaLanguageOf('hola, I need a cita')).toBe('mixed')
    expect(layaLanguageOf('👍')).toBe('unknown')
  })

  it('only observes typed replies with letters, not shortcuts or option numbers', () => {
    expect(isObservableTypedReply('quiero una cita')).toBe(true)
    expect(isObservableTypedReply('0')).toBe(false)
    expect(isObservableTypedReply('12')).toBe(false)
    expect(isObservableTypedReply('👍')).toBe(false)
    expect(isObservableTypedReply(' ')).toBe(false)
  })

  it('maps 1–7 menu options to candidates and skips anything LAYA cannot score', () => {
    expect(menuBranchCandidates([{ optionId: 'book', title: 'Book', description: 'See dates' }, { optionId: '__more__', title: 'See more' }]))
      .toEqual([{ id: 'book', label: 'Book — See dates' }])
    expect(menuBranchCandidates([])).toBeNull()
    expect(menuBranchCandidates(Array.from({ length: 8 }, (_, i) => ({ optionId: `o${i}`, title: `Option ${i}` })))).toBeNull()
    expect(menuBranchCandidates([{ optionId: 'a', title: 'A' }, { optionId: 'a', title: 'B' }])).toBeNull()
  })
})

describe('LAYA caller deadline setting', () => {
  it('accepts whole milliseconds from 100 to 5000', () => {
    expect(parseLayaTimeoutMs('2500')).toBe(2500)
    expect(parseLayaTimeoutMs(' 750 ')).toBe(750)
  })
  it.each([undefined, '', '99', '5001', '2.5', '2500ms', '-1', '25000'])('ignores %s', raw => {
    expect(parseLayaTimeoutMs(raw)).toBeUndefined()
  })
})
