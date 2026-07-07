import { describe, it, expect, vi } from 'vitest'

// agent-processor pulls in heavy workspace deps at import time; stub them so we can
// unit-test the pure detectUpsetTone export in isolation.
vi.mock('@docmee/llm', () => ({ classifyIntent: vi.fn(), claudeComplete: vi.fn(), embedText: vi.fn() }))
vi.mock('@docmee/agents', () => ({
  routeIntent: vi.fn(),
  runClinicBot: vi.fn(),
  searchKb: vi.fn(),
  isInsideBusinessHours: vi.fn(),
  detectLanguage: vi.fn(),
}))
vi.mock('@docmee/channels', () => ({
  sendWhatsAppText: vi.fn(),
  sendMessengerText: vi.fn(),
  sendInstagramText: vi.fn(),
}))
vi.mock('@docmee/queue', () => ({ schedulingQueue: { add: vi.fn() }, notificationQueue: { add: vi.fn() } }))
vi.mock('@docmee/db', () => ({
  createServiceDbClient: vi.fn(),
  createClinicsRepository: vi.fn(),
  createChannelAccountsRepository: vi.fn(),
  createPatientsRepository: vi.fn(),
  createKnowledgeRepository: vi.fn(),
  createErrorReviewsRepository: vi.fn(),
  createConversationsRepository: vi.fn(),
}))

import { detectUpsetTone, getClinicBotConfig } from '../agent-processor.worker.js'
import type { Clinic } from '@docmee/db'

const clinic = (settings: Record<string, unknown>): Clinic =>
  ({ id: 'c1', name: 'Clínica Demo', settings, timezone: 'America/Mexico_City' }) as unknown as Clinic

describe('getClinicBotConfig', () => {
  it('reads the flat tone + rules keys the Admin Studio UI persists', () => {
    // Clinic-Specific Rules / Bot Tone (Req 27 / Req 26): the Studio saves
    // settings.botTone + settings.clinicRules — these must reach the bot config.
    const cfg = getClinicBotConfig(clinic({ botTone: 'friendly', clinicRules: 'Mayores de 18 años.' }))
    expect(cfg.tone).toBe('friendly')
    expect(cfg.rulesText).toBe('Mayores de 18 años.')
  })

  it('falls back to safe defaults when nothing is configured', () => {
    const cfg = getClinicBotConfig(clinic({}))
    expect(cfg).toMatchObject({ tone: 'professional', language: 'auto', rulesText: null })
  })

  it('treats a blank rules string as no rules', () => {
    expect(getClinicBotConfig(clinic({ clinicRules: '   ' })).rulesText).toBeNull()
  })

  it('still honors the legacy nested settings.bot.* shape', () => {
    const cfg = getClinicBotConfig(clinic({ bot: { tone: 'brief', rulesText: 'Sin precios por chat.' } }))
    expect(cfg.tone).toBe('brief')
    expect(cfg.rulesText).toBe('Sin precios por chat.')
  })

  it('flat keys win over the legacy nested shape', () => {
    const cfg = getClinicBotConfig(clinic({ botTone: 'friendly', bot: { tone: 'brief' } }))
    expect(cfg.tone).toBe('friendly')
  })
})

describe('detectUpsetTone', () => {
  it('flags upset Spanish keywords', () => {
    expect(detectUpsetTone('Esto es una estafa, estoy muy molesto')).toBe(true)
    expect(detectUpsetTone('El servicio es PÉSIMO')).toBe(true)
    expect(detectUpsetTone('la app no funciona')).toBe(true)
  })

  it('flags upset English keywords', () => {
    expect(detectUpsetTone('this is awful and I am upset')).toBe(true)
  })

  it('does not flag neutral messages', () => {
    expect(detectUpsetTone('Hola, quiero agendar una cita por favor')).toBe(false)
    expect(detectUpsetTone('Thank you so much!')).toBe(false)
  })
})
